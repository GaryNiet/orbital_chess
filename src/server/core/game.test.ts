import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { MemoryStore } from './store.ts';
import {
  adjudicate,
  buildTree,
  closeFinishedDays,
  getDayTree,
  getHistory,
  getStats,
  keys,
  nextPosition,
  playMove,
  startFenFor,
} from './game.ts';
import { resetAllData, seedDemoData, simulateBotMoves } from './bots.ts';
import { OPENINGS, openingFor } from '../../shared/openings.ts';
import { isAncestorOrSelf } from '../../shared/api.ts';

const DAY = '2026-11-25';
const NOON = Date.parse(`${DAY}T12:00:00Z`);
const TOMORROW = NOON + 86_400_000;

const serve = async (store: MemoryStore, user: string, now = NOON, skip = false) => {
  const r = await nextPosition(store, user, { now, skip, rand: () => 0 });
  assert.equal(r.type, 'position', r.type === 'none' ? r.message : '');
  if (r.type !== 'position') throw new Error('unreachable');
  return r.position;
};

/** Serves `user` and plays the first legal move matching `pick` (or the first move). */
const play = async (store: MemoryStore, user: string, uci?: string, now = NOON) => {
  const p = await serve(store, user, now);
  const legal = new Chess(p.fen).moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`);
  const move = uci && legal.includes(uci) ? uci : legal[0]!;
  const res = await playMove(store, user, { day: p.day, nodeId: p.nodeId, uci: move }, { now });
  assert.equal(res.type, 'ok', res.type === 'error' ? res.message : '');
  return { p, res, move };
};

void test('every opening line is legal', () => {
  for (const o of OPENINGS) {
    const c = new Chess();
    for (const san of o.san) assert.doesNotThrow(() => c.move(san), `${o.name}: ${san}`);
  }
});

void test('the day starts from the end of its opening', async () => {
  const store = new MemoryStore();
  const p = await serve(store, 'alice');
  assert.equal(p.nodeId, 'r');
  assert.equal(p.fen, startFenFor(DAY));
  assert.equal(p.ply, openingFor(DAY).san.length + 1);
  assert.deepEqual(p.opening, openingFor(DAY));
});

void test('never two moves on the same path, but other branches are fine', async () => {
  const store = new MemoryStore();
  // alice opens the day at the root: every position is now downstream of her.
  await play(store, 'alice');
  const r = await nextPosition(store, 'alice', { now: NOON });
  assert.equal(r.type, 'none');

  // bob and carol are both handed the root's child (same state, two people).
  const b = await serve(store, 'bob');
  const c = await serve(store, 'carol');
  assert.equal(b.nodeId, c.nodeId);
  const legal = new Chess(b.fen).moves({ verbose: true }).map((m) => `${m.from}${m.to}`);
  await playMove(store, 'bob', { day: DAY, nodeId: b.nodeId, uci: legal[0]! }, { now: NOON });
  await playMove(store, 'carol', { day: DAY, nodeId: c.nodeId, uci: legal[1]! }, { now: NOON });

  // Two branches now hang off that position. dave plays on bob's branch...
  const { p: d1 } = await play(store, 'dave');
  // ...and may play again, but only on a position not on that path.
  const d2 = await serve(store, 'dave');
  assert.ok(!isAncestorOrSelf(d1.nodeId, d2.nodeId) && !isAncestorOrSelf(d2.nodeId, d1.nodeId));
});

void test('same move from the same position merges into one node', async () => {
  const store = new MemoryStore();
  await play(store, 'alice');
  const a = await serve(store, 'bob');
  const b = await serve(store, 'carol');
  const uci = new Chess(a.fen).moves({ verbose: true }).map((m) => `${m.from}${m.to}`)[0]!;
  const r1 = await playMove(store, 'bob', { day: DAY, nodeId: a.nodeId, uci }, { now: NOON });
  const r2 = await playMove(store, 'carol', { day: DAY, nodeId: b.nodeId, uci }, { now: NOON });
  assert.ok(r1.type === 'ok' && r1.newBranch);
  assert.ok(r2.type === 'ok' && !r2.newBranch);
});

void test('a position must be reserved and moves must be legal', async () => {
  const store = new MemoryStore();
  const p = await serve(store, 'erin');
  const illegal = await playMove(store, 'erin', { day: DAY, nodeId: p.nodeId, uci: 'a1a8' }, { now: NOON });
  assert.equal(illegal.type, 'error');
  const notMine = await playMove(store, 'frank', { day: DAY, nodeId: p.nodeId, uci: 'a2a3' }, { now: NOON });
  assert.equal(notMine.type, 'error');
  const late = await playMove(store, 'erin', { day: DAY, nodeId: p.nodeId, uci: 'a2a3' }, { now: TOMORROW });
  assert.equal(late.type, 'error');
});

void test('adjudication counts material', () => {
  assert.equal(adjudicate('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), '1-0');
  assert.equal(adjudicate('4k3/8/8/8/8/8/P7/4K3 w - - 0 1'), '1/2-1/2');
  assert.equal(adjudicate('q3k3/8/8/8/8/8/8/4K3 w - - 0 1'), '0-1');
});

void test('branch results add up the tree', () => {
  const node = (fen: string, uci: string, ply: number, end: unknown = null) =>
    JSON.stringify({ fen, san: uci, uci, ply, at: 0, end });
  const level = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
  const whiteUp = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  const tree = buildTree(
    {
      r: node(level, '', 10),
      'r.a': node(level, 'a', 11),
      'r.a.x': node(whiteUp, 'x', 12),
      'r.a.y': node(level, 'y', 12, { result: '0-1', reason: 'checkmate' }),
      'r.b': node(whiteUp, 'b', 11),
    },
    { 'u1|r': 'a', 'u2|r': 'b', 'u3|r.a': 'x', 'u4|r.a': 'y' }
  );
  const byId = new Map(tree.map((n) => [n.id, n]));
  assert.deepEqual(byId.get('r')!.out, { w: 2, d: 0, b: 1 });
  assert.deepEqual(byId.get('r.a')!.out, { w: 1, d: 0, b: 1 });
  assert.deepEqual(byId.get('r.a')!.players, ['u1']);
  assert.equal(byId.get('r.b')!.end!.reason, 'adjudicated');
});

void test('closing the day reveals the tree and credits win rates', async () => {
  const store = new MemoryStore();
  await play(store, 'alice');
  await play(store, 'bob');
  await play(store, 'carol');
  assert.equal((await getStats(store, 'bob')).pending, 1);
  assert.equal(await getDayTree(store, DAY), null); // hidden while the day runs

  await closeFinishedDays(store, TOMORROW);
  const tree = await getDayTree(store, DAY);
  assert.ok(tree);
  assert.equal(tree.nodes.length, 4);
  const bob = await getStats(store, 'bob');
  assert.equal(bob.pending, 0);
  assert.equal(bob.moves, 1);
  assert.ok(bob.winRate === 0 || bob.winRate === 100); // single line: won or not
  const h = await getHistory(store, 'bob');
  assert.equal(h.days[0]!.closed, true);
  assert.notEqual(h.days[0]!.moves[0]!.out, null);
  // Closing twice changes nothing.
  await closeFinishedDays(store, TOMORROW);
  assert.equal((await getStats(store, 'bob')).moves, 1);
});

void test('seed, simulate and reset', async () => {
  const store = new MemoryStore();
  const now = NOON;
  const r = await seedDemoData(store, { realUser: 'me', pastDays: 2, movesPerDay: 40, movesToday: 16, now });
  assert.ok(r.moves > 50);
  const me = await getStats(store, 'me');
  assert.ok(me.moves > 0, 'real user has finished moves');
  assert.ok(me.pending > 0, 'real user has moves today');
  const sim = await simulateBotMoves(store, 20, { seed: 3, now });
  assert.ok(sim.played > 0);
  await resetAllData(store);
  assert.equal(await store.zCard(keys.daysAll), 0);
  assert.deepEqual(await store.hGetAll(keys.userStats('me')), {});
});
