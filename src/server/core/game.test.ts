import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from './store.ts';
import { applyMove, getHistory, getStats, keys, LOCK_MS, nextGame } from './game.ts';
import { resetAllData, seedDemoData, simulateBotMoves } from './bots.ts';

const serve = async (store: MemoryStore, user: string, skip = false) => {
  const r = await nextGame(store, user, { skip, rand: () => 0.5 });
  assert.equal(r.type, 'game');
  if (r.type !== 'game') throw new Error('unreachable');
  return r;
};

const play = async (store: MemoryStore, user: string, uci: string) => {
  const r = await serve(store, user);
  const res = await applyMove(store, user, { gameId: r.game.id, ply: r.game.moves.length, uci });
  assert.equal(res.type, 'ok', res.type === 'error' ? res.message : '');
  return res;
};

void test('a player gets one move per game and the board passes on', async () => {
  const store = new MemoryStore();
  const a = await serve(store, 'alice');
  assert.equal(a.color, 'w');
  // While Alice holds the board, Bob gets a different (new) one.
  const b = await serve(store, 'bob');
  assert.notEqual(a.game.id, b.game.id);

  await applyMove(store, 'alice', { gameId: a.game.id, ply: 0, uci: 'e2e4' });
  // Alice can never move in that game again.
  const again = await applyMove(store, 'alice', { gameId: a.game.id, ply: 1, uci: 'e7e5' });
  assert.equal(again.type, 'error');
  // Bob still holds his board, so Alice is handed a fresh one.
  const a2 = await serve(store, 'alice');
  assert.notEqual(a2.game.id, a.game.id);
});

void test('reloading returns the same reserved board; skip gives another', async () => {
  const store = new MemoryStore();
  const first = await serve(store, 'carol');
  const reload = await serve(store, 'carol');
  assert.equal(reload.game.id, first.game.id);
  const skipped = await serve(store, 'carol', true);
  assert.notEqual(skipped.game.id, first.game.id);
});

void test('illegal and stale moves are rejected', async () => {
  const store = new MemoryStore();
  const r = await serve(store, 'dave');
  const illegal = await applyMove(store, 'dave', { gameId: r.game.id, ply: 0, uci: 'e2e5' });
  assert.equal(illegal.type, 'error');
  const stale = await applyMove(store, 'dave', { gameId: r.game.id, ply: 3, uci: 'e2e4' });
  assert.equal(stale.type, 'error');
});

void test('expired reservations cannot move', async () => {
  const store = new MemoryStore();
  let now = 1_000_000;
  store.now = () => now;
  const r = await nextGame(store, 'erin', { now });
  assert.equal(r.type, 'game');
  if (r.type !== 'game') return;
  now += LOCK_MS + 1;
  const res = await applyMove(store, 'erin', { gameId: r.game.id, ply: 0, uci: 'e2e4' }, { now });
  assert.equal(res.type, 'error');
});

void test("fool's mate settles stats for all four players", async () => {
  const store = new MemoryStore();
  await play(store, 'w1', 'f2f3');
  await play(store, 'b1', 'e7e5');
  await play(store, 'w2', 'g2g4');
  const last = await play(store, 'b2', 'd8h4');
  assert.equal(last.game.status, 'finished');
  assert.equal(last.game.result, '0-1');
  assert.equal(last.game.reason, 'checkmate');

  const b1 = await getStats(store, 'b1');
  assert.deepEqual([b1.wins, b1.losses, b1.pending, b1.winRate], [1, 0, 0, 100]);
  const w2 = await getStats(store, 'w2');
  assert.deepEqual([w2.wins, w2.losses, w2.pending, w2.winRate], [0, 1, 0, 0]);

  const h = await getHistory(store, 'w2');
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0]!.san, 'g4');
  assert.equal(h.entries[0]!.outcome, 'loss');
  assert.equal(await store.zCard(keys.active), 0);
});

void test('seeding and simulation produce consistent stats', async () => {
  const store = new MemoryStore();
  const r = await seedDemoData(store, { realUser: 'me', games: 12, seed: 7, now: Date.now() });
  assert.ok(r.finished > 0);
  const me = await getStats(store, 'me');
  const hist = await getHistory(store, 'me', 0, 100);
  const finished = hist.entries.filter((e) => e.outcome !== null).length;
  assert.equal(me.wins + me.losses + me.draws, finished);
  assert.equal(me.pending, hist.entries.length - finished);

  const sim = await simulateBotMoves(store, 25, { seed: 3 });
  assert.ok(sim.played > 0);

  await resetAllData(store);
  assert.equal(await store.zCard(keys.allGames), 0);
  assert.deepEqual(await store.hGetAll(keys.userStats('me')), {});
});
