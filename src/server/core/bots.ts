import { Chess, type Move } from 'chess.js';
import { dayOf } from '../../shared/openings.ts';
import { closeFinishedDays, keys, nextPosition, playMove } from './game.ts';
import type { Store } from './store.ts';

// ---------------------------------------------------------------------------
// Fake players for testing. They don't think: a random legal move, with a
// slight taste for captures so lines don't stay perfectly level.
// ---------------------------------------------------------------------------

export const pickRandomMove = (chess: Chess, rand: () => number): Move | null => {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const captures = moves.filter((m) => m.captured);
  const pool = captures.length && rand() < 0.5 ? captures : moves;
  return pool[Math.floor(rand() * pool.length)]!;
};

const ADJ = [
  'brave', 'sleepy', 'quiet', 'rapid', 'sly', 'lucky', 'grumpy', 'clever',
  'wild', 'calm', 'bold', 'fuzzy', 'royal', 'tiny', 'mighty', 'cosmic',
];
const NOUN = [
  'knight', 'bishop', 'rook', 'pawn', 'gambit', 'castle', 'otter', 'falcon',
  'badger', 'comet', 'wizard', 'panda', 'fork', 'tempo',
];

export const fakeUsernames = (count: number): string[] => {
  const names: string[] = [];
  for (let i = 0; names.length < count; i++) {
    const a = ADJ[i % ADJ.length]!;
    const n = NOUN[Math.floor(i / ADJ.length) % NOUN.length]!;
    const suffix = Math.floor(i / (ADJ.length * NOUN.length));
    names.push(`${a}_${n}${suffix ? suffix : ''}`);
  }
  return names;
};

/** Deterministic PRNG so seeded data is reproducible. */
export const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** One player takes one turn through the real game service. */
export const botTurn = async (store: Store, user: string, now: number, rand: () => number) => {
  const r = await nextPosition(store, user, { now, rand });
  if (r.type !== 'position') return false;
  const m = pickRandomMove(new Chess(r.position.fen), rand);
  if (!m) return false;
  const res = await playMove(
    store,
    user,
    { day: r.position.day, nodeId: r.position.nodeId, uci: `${m.from}${m.to}${m.promotion ?? ''}` },
    { now }
  );
  return res.type === 'ok';
};

// A smallish pool so fake players build up enough scored moves to rank.
const BOTS = fakeUsernames(70);

/** Fake players make `count` moves on today's tree. */
export const simulateBotMoves = async (
  store: Store,
  count: number,
  opts: { seed?: number; now?: number } = {}
) => {
  const rand = mulberry32(opts.seed ?? Date.now());
  const now = opts.now ?? Date.now();
  let played = 0;
  for (let i = 0; i < count * 2 && played < count; i++) {
    if (await botTurn(store, BOTS[Math.floor(rand() * BOTS.length)]!, now, rand)) played++;
  }
  return { played };
};

export type SeedOptions = {
  /** Real user who gets (random) moves in the fake days, so their history isn't empty. */
  realUser?: string | null;
  pastDays?: number;
  movesPerDay?: number;
  movesToday?: number;
  seed?: number;
  now?: number;
};

/**
 * Plays several past days plus part of today with fake players, then closes
 * the past days so their trees, win rates and the leaderboard are populated.
 */
export const seedDemoData = async (store: Store, opts: SeedOptions = {}) => {
  const rand = mulberry32(opts.seed ?? 42);
  const now = opts.now ?? Date.now();
  const pastDays = opts.pastDays ?? 4;
  const perDay = opts.movesPerDay ?? 70;
  const today = opts.movesToday ?? 30;
  const realUser = opts.realUser ?? null;
  const todayStart = Date.parse(`${dayOf(now)}T00:00:00Z`);
  let moves = 0;

  const playDay = async (start: number, end: number, n: number) => {
    for (let t = 0; t < n; t++) {
      const at = Math.floor(start + ((end - start) * (t + 1)) / (n + 1));
      // The real user takes roughly one turn in eight.
      const user = realUser && t % 8 === 3 ? realUser : BOTS[Math.floor(rand() * BOTS.length)]!;
      if (await botTurn(store, user, at, rand)) moves++;
    }
  };

  for (let k = pastDays; k >= 1; k--) {
    const start = todayStart - k * 86_400_000;
    await playDay(start + 60_000, start + 86_400_000 - 60_000, perDay);
  }
  await closeFinishedDays(store, now);
  await playDay(todayStart + 1000, Math.max(todayStart + 2000, now - 1000), today);
  return { days: pastDays + 1, moves };
};

/** Deletes everything this app wrote that is reachable from its indexes. */
export const resetAllData = async (store: Store) => {
  const days = (await store.zRange(keys.daysAll, 0, -1, { by: 'rank' })).map((x) => x.member);
  const users = (await store.zRange(keys.allUsers, 0, -1, { by: 'rank' })).map((x) => x.member);
  for (const d of days) {
    await store.del(
      keys.dayNodes(d),
      keys.dayPlays(d),
      keys.dayOpen(d),
      keys.dayMeta(d),
      keys.dayUsers(d),
      keys.dayTree(d)
    );
  }
  for (const u of users) {
    await store.del(keys.userDays(u), keys.userStats(u), keys.userCurrent(u));
    for (const d of days) await store.del(keys.userDay(u, d));
  }
  await store.del(
    keys.daysAll,
    keys.daysActive,
    keys.daysClosed,
    keys.allUsers,
    keys.leaderboard,
    keys.clockOffset
  );
  return { days: days.length, users: users.length };
};
