import { Chess, type Move } from 'chess.js';
import type { MoveRecord } from '../../shared/api.ts';
import { colorOfPly, outcomeFor } from '../../shared/api.ts';
import {
  applyMove,
  detectEnd,
  keys,
  loadGame,
  MAX_PLIES,
  refreshLeaderboard,
  replay,
  START_FEN,
} from './game.ts';
import type { Store } from './store.ts';

// ---------------------------------------------------------------------------
// A tiny one-ply "engine" for fake players. It is deliberately weak: it grabs
// material, likes giving check, avoids hanging pieces and always plays mate in
// one. Good enough to produce believable, mostly decisive games.
// ---------------------------------------------------------------------------

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const scoreMove = (chess: Chess, m: Move): number => {
  let score = 0;
  if (m.captured) score += VALUE[m.captured]! * 10;
  if (m.promotion) score += VALUE[m.promotion]! * 8;
  chess.move(m);
  if (chess.isCheckmate()) score += 10_000;
  else if (chess.isStalemate()) score -= 50;
  else {
    if (chess.isCheck()) score += 4;
    // Penalise leaving the moved piece where the opponent can take it.
    if (chess.isAttacked(m.to, chess.turn())) score -= VALUE[m.piece]! * 9;
  }
  chess.undo();
  return score;
};

export const pickBotMove = (chess: Chess, rand: () => number, noise = 12): Move | null => {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;
  let best: Move | null = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = scoreMove(chess, m) + rand() * noise;
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
};

export const uciOf = (m: Move) => `${m.from}${m.to}${m.promotion ?? ''}`;

// ---------------------------------------------------------------------------
// Fake players
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export type SeedOptions = {
  /** Real user to sprinkle into some of the games (so their history isn't empty). */
  realUser?: string | null;
  games?: number;
  seed?: number;
  now?: number;
};

/**
 * Writes a batch of fake games. Games are played out in memory and then
 * written with a handful of Redis calls each, so this is fast enough to run
 * from a moderator menu action.
 */
export const seedDemoData = async (store: Store, opts: SeedOptions = {}) => {
  const rand = mulberry32(opts.seed ?? 42);
  const now = opts.now ?? Date.now();
  const gameCount = opts.games ?? 24;
  const pool = fakeUsernames(MAX_PLIES + 40);
  const realUser = opts.realUser ?? null;

  // Aggregated per-user changes, written at the end.
  const tally = new Map<
    string,
    { wins: number; losses: number; draws: number; pending: number; games: Map<string, number> }
  >();
  const bump = (u: string) => {
    let t = tally.get(u);
    if (!t) {
      t = { wins: 0, losses: 0, draws: 0, pending: 0, games: new Map() };
      tally.set(u, t);
    }
    return t;
  };

  let finishedCount = 0;
  for (let gi = 0; gi < gameCount; gi++) {
    // About 60% of games get played to the end, the rest stop part-way.
    const playToEnd = rand() < 0.6;
    const targetPlies = playToEnd ? MAX_PLIES : 4 + Math.floor(rand() * 60);
    // Put the real user in two out of three games, at a random early ply.
    const realPly =
      realUser && gi % 3 !== 2 ? 1 + Math.floor(rand() * Math.min(targetPlies, 30)) : -1;

    const start = now - (gameCount - gi) * 3 * 3600_000 - Math.floor(rand() * 3600_000);
    const users = [...pool].sort(() => rand() - 0.5);
    const chess = new Chess();
    const moves: MoveRecord[] = [];
    let end: ReturnType<typeof detectEnd> = null;
    let t = start;
    while (moves.length < targetPlies) {
      const m = pickBotMove(chess, rand);
      if (!m) break;
      chess.move(m);
      const ply = moves.length + 1;
      t += 60_000 + Math.floor(rand() * 20 * 60_000);
      const user = ply === realPly && realUser ? realUser : users[ply - 1]!;
      moves.push({ ply, san: m.san, uci: uciOf(m), user, at: Math.min(t, now - 1000) });
      end = detectEnd(chess, ply);
      if (end) break;
    }
    if (moves.length === 0) continue;

    const n = await store.incrBy(keys.seq, 1);
    const id = `g${n}`;
    const last = moves[moves.length - 1]!.at;
    await store.hSet(keys.game(id), {
      status: end ? 'finished' : 'active',
      result: end ? end.result : '*',
      reason: end ? end.reason : '',
      fen: chess.fen(),
      moves: JSON.stringify(moves),
      createdAt: String(start),
      updatedAt: String(last),
    });
    await store.hSet(
      keys.players(id),
      Object.fromEntries(moves.map((m) => [m.user, String(m.ply)]))
    );
    await store.hSet(
      keys.plyClaims(id),
      Object.fromEntries(moves.map((m) => [String(m.ply), m.user]))
    );
    await store.zAdd(keys.allGames, { member: id, score: start });
    if (end) {
      finishedCount++;
      await store.zAdd(keys.finished, { member: id, score: last });
    } else {
      await store.zAdd(keys.active, { member: id, score: last });
    }

    for (const m of moves) {
      const tt = bump(m.user);
      tt.games.set(id, m.at);
      const o = end ? outcomeFor(colorOfPly(m.ply), end.result) : null;
      if (o === 'win') tt.wins++;
      else if (o === 'loss') tt.losses++;
      else if (o === 'draw') tt.draws++;
      else tt.pending++;
    }
  }

  for (const [user, t] of tally) {
    const sk = keys.userStats(user);
    if (t.wins) await store.hIncrBy(sk, 'wins', t.wins);
    if (t.losses) await store.hIncrBy(sk, 'losses', t.losses);
    if (t.draws) await store.hIncrBy(sk, 'draws', t.draws);
    if (t.pending) await store.hIncrBy(sk, 'pending', t.pending);
    await store.zAdd(
      keys.userGames(user),
      ...[...t.games].map(([member, score]) => ({ member, score }))
    );
    await store.zAdd(keys.allUsers, { member: user, score: now });
    await refreshLeaderboard(store, user);
  }

  return { games: gameCount, finished: finishedCount, players: tally.size };
};

// ---------------------------------------------------------------------------
// Simulation: let fake players move on live boards, so you can watch your
// pending games finish and your win rate update.
// ---------------------------------------------------------------------------

export const simulateBotMoves = async (
  store: Store,
  count: number,
  opts: { seed?: number; now?: number } = {}
) => {
  const rand = mulberry32(opts.seed ?? Date.now());
  const pool = fakeUsernames(MAX_PLIES + 40);
  let played = 0;
  let finished = 0;
  const active = await store.zRange(keys.active, 0, 199, { by: 'rank' });
  if (active.length === 0) return { played, finished };

  for (let i = 0; i < count * 3 && played < count; i++) {
    const { member: id } = active[Math.floor(rand() * active.length)]!;
    if (await store.get(keys.lock(id))) continue; // a human is looking at it
    const g = await loadGame(store, id);
    if (!g || g.status !== 'active') continue;
    const taken = new Set(g.moves.map((m) => m.user));
    const bot = pool.find((u) => !taken.has(u));
    if (!bot) continue;
    const chess = g.moves.length ? replay(g.moves) : new Chess(START_FEN);
    const m = pickBotMove(chess, rand);
    if (!m) continue;
    const res = await applyMove(
      store,
      bot,
      { gameId: id, ply: g.moves.length, uci: uciOf(m) },
      { requireLock: false, ...(opts.now !== undefined ? { now: opts.now } : {}) }
    );
    if (res.type === 'ok') {
      played++;
      if (res.game.status === 'finished') finished++;
    }
  }
  return { played, finished };
};

/** Deletes everything this app wrote that is reachable from its indexes. */
export const resetAllData = async (store: Store) => {
  const games = await store.zRange(keys.allGames, 0, -1, { by: 'rank' });
  for (const { member } of games) {
    await store.del(
      keys.game(member),
      keys.players(member),
      keys.plyClaims(member),
      keys.lock(member)
    );
  }
  const users = await store.zRange(keys.allUsers, 0, -1, { by: 'rank' });
  for (const { member } of users) {
    await store.del(keys.userGames(member), keys.userStats(member), keys.userCurrent(member));
  }
  await store.del(
    keys.active,
    keys.finished,
    keys.allGames,
    keys.allUsers,
    keys.leaderboard
  );
  return { games: games.length, users: users.length };
};
