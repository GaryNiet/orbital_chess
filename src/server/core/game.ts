import { Chess } from 'chess.js';
import type {
  EndReason,
  GameResult,
  GameStatus,
  GameView,
  HistoryEntry,
  HistoryResponse,
  LeaderboardResponse,
  MoveRecord,
  MoveRequest,
  MoveResponse,
  NextGameResponse,
  Stats,
} from '../../shared/api.ts';
import { colorOfPly, outcomeFor } from '../../shared/api.ts';
import type { Store } from './store.ts';

/** How long a served board is reserved for one player. */
export const LOCK_MS = 3 * 60_000;
/** Games that reach this many plies are declared drawn. */
export const MAX_PLIES = 200;
/** Never keep more than this many games running at once. */
export const MAX_ACTIVE = 500;
/** Finished games needed before a player shows up on the leaderboard. */
export const LEADERBOARD_MIN_GAMES = 5;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const keys = {
  seq: 'seq:game',
  game: (id: string) => `game:${id}`,
  players: (id: string) => `game:${id}:players`,
  plyClaims: (id: string) => `game:${id}:claims`,
  lock: (id: string) => `game:${id}:lock`,
  active: 'games:active',
  finished: 'games:finished',
  allGames: 'games:all',
  userGames: (u: string) => `user:${u}:games`,
  userStats: (u: string) => `user:${u}:stats`,
  userCurrent: (u: string) => `user:${u}:current`,
  allUsers: 'users:all',
  leaderboard: 'leaderboard',
};

export type GameRecord = {
  id: string;
  status: GameStatus;
  result: GameResult;
  reason: EndReason | null;
  fen: string;
  moves: MoveRecord[];
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export const loadGame = async (store: Store, id: string): Promise<GameRecord | null> => {
  const h = await store.hGetAll(keys.game(id));
  if (!h.fen) return null;
  return {
    id,
    status: h.status === 'finished' ? 'finished' : 'active',
    result: (h.result as GameResult | undefined) ?? '*',
    reason: h.reason ? (h.reason as EndReason) : null,
    fen: h.fen,
    moves: h.moves ? (JSON.parse(h.moves) as MoveRecord[]) : [],
    createdAt: Number(h.createdAt ?? 0),
    updatedAt: Number(h.updatedAt ?? 0),
  };
};

const saveGame = async (store: Store, g: GameRecord) => {
  await store.hSet(keys.game(g.id), {
    status: g.status,
    result: g.result,
    reason: g.reason ?? '',
    fen: g.fen,
    moves: JSON.stringify(g.moves),
    createdAt: String(g.createdAt),
    updatedAt: String(g.updatedAt),
  });
};

export const createGame = async (store: Store, now = Date.now()): Promise<GameRecord> => {
  const n = await store.incrBy(keys.seq, 1);
  const g: GameRecord = {
    id: `g${n}`,
    status: 'active',
    result: '*',
    reason: null,
    fen: START_FEN,
    moves: [],
    createdAt: now,
    updatedAt: now,
  };
  await saveGame(store, g);
  await store.zAdd(keys.active, { member: g.id, score: now });
  await store.zAdd(keys.allGames, { member: g.id, score: now });
  return g;
};

export const toView = (g: GameRecord, viewer: string | null): GameView => {
  const mine = viewer ? g.moves.find((m) => m.user === viewer) : undefined;
  return {
    id: g.id,
    status: g.status,
    result: g.result,
    reason: g.reason,
    fen: g.fen,
    moves: g.moves,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    myMove: mine ? { ...mine, color: colorOfPly(mine.ply) } : null,
  };
};

// ---------------------------------------------------------------------------
// Chess helpers
// ---------------------------------------------------------------------------

export const parseUci = (uci: string) => {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!m) return null;
  const move: { from: string; to: string; promotion?: string } = { from: m[1]!, to: m[2]! };
  if (m[3]) move.promotion = m[3];
  return move;
};

/** Replays a game's moves so repetition rules see the full history. */
export const replay = (moves: MoveRecord[]): Chess => {
  const chess = new Chess();
  for (const m of moves) {
    const p = parseUci(m.uci);
    if (!p) throw new Error(`corrupt move ${m.uci}`);
    chess.move(p);
  }
  return chess;
};

export const detectEnd = (
  chess: Chess,
  plies: number
): { result: GameResult; reason: EndReason } | null => {
  if (chess.isCheckmate()) {
    // The side to move has been mated.
    return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  }
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial())
    return { result: '1/2-1/2', reason: 'insufficient-material' };
  if (chess.isThreefoldRepetition())
    return { result: '1/2-1/2', reason: 'threefold-repetition' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'fifty-move-rule' };
  if (plies >= MAX_PLIES) return { result: '1/2-1/2', reason: 'move-limit' };
  return null;
};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const winRateOf = (wins: number, losses: number, draws: number) => {
  const total = wins + losses + draws;
  return total === 0 ? null : (wins / total) * 100;
};

export const getStats = async (store: Store, user: string): Promise<Stats> => {
  const h = await store.hGetAll(keys.userStats(user));
  const wins = Number(h.wins ?? 0);
  const losses = Number(h.losses ?? 0);
  const draws = Number(h.draws ?? 0);
  const pending = Number(h.pending ?? 0);
  let rank: number | null = null;
  const asc = await store.zRank(keys.leaderboard, user);
  if (asc !== undefined) {
    const n = await store.zCard(keys.leaderboard);
    rank = n - asc;
  }
  return { wins, losses, draws, pending, winRate: winRateOf(wins, losses, draws), rank };
};

const settleGame = async (store: Store, g: GameRecord) => {
  // Every player made exactly one move, so `moves` is the full player list.
  for (const m of g.moves) {
    const outcome = outcomeFor(colorOfPly(m.ply), g.result);
    if (!outcome) continue;
    const field = outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws';
    const statsKey = keys.userStats(m.user);
    await store.hIncrBy(statsKey, field, 1);
    await store.hIncrBy(statsKey, 'pending', -1);
    await refreshLeaderboard(store, m.user);
  }
};

/** Leaderboard score: win rate first, then number of finished games. */
export const refreshLeaderboard = async (store: Store, user: string) => {
  const s = await store.hGetAll(keys.userStats(user));
  const w = Number(s.wins ?? 0);
  const l = Number(s.losses ?? 0);
  const d = Number(s.draws ?? 0);
  const total = w + l + d;
  if (total < LEADERBOARD_MIN_GAMES) return;
  const rate = winRateOf(w, l, d) ?? 0;
  await store.zAdd(keys.leaderboard, {
    member: user,
    score: Math.round(rate * 100) * 100_000 + Math.min(total, 99_999),
  });
};

// ---------------------------------------------------------------------------
// Matchmaking
// ---------------------------------------------------------------------------

const tryReserve = async (
  store: Store,
  user: string,
  id: string,
  now: number
): Promise<GameRecord | null> => {
  if (await store.hGet(keys.players(id), user)) return null; // already moved here
  const lockKey = keys.lock(id);
  const holder = await store.get(lockKey);
  if (holder && holder !== user) return null;
  const expiration = new Date(now + LOCK_MS);
  if (!holder) {
    await store.set(lockKey, user, { nx: true, expiration });
    if ((await store.get(lockKey)) !== user) return null; // lost the race
  } else {
    await store.set(lockKey, user, { expiration });
  }
  const g = await loadGame(store, id);
  if (!g || g.status !== 'active') {
    await store.del(lockKey);
    return null;
  }
  await store.set(keys.userCurrent(user), id, { expiration });
  return g;
};

const shuffle = <T>(xs: T[], rand: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/**
 * Hands the player a board to move on. The same board is returned until the
 * player moves, skips, or the reservation expires, so reloading does not let
 * anyone cherry-pick positions. Boards that have waited longest are favoured
 * so that every game keeps progressing.
 */
export const nextGame = async (
  store: Store,
  user: string,
  opts: { skip?: boolean; now?: number; rand?: () => number } = {}
): Promise<NextGameResponse> => {
  const now = opts.now ?? Date.now();
  const rand = opts.rand ?? Math.random;
  const current = await store.get(keys.userCurrent(user));
  let exclude: string | null = null;

  if (current) {
    if (opts.skip) {
      exclude = current;
      if ((await store.get(keys.lock(current))) === user) await store.del(keys.lock(current));
      await store.del(keys.userCurrent(user));
    } else {
      const g = await tryReserve(store, user, current, now);
      if (g) return served(g, user, now);
    }
  }

  // Look at the 60 boards that have waited longest, in a shuffled order.
  const candidates = await store.zRange(keys.active, 0, 59, { by: 'rank' });
  for (const { member } of shuffle(candidates, rand)) {
    if (member === exclude) continue;
    const g = await tryReserve(store, user, member, now);
    if (g) return served(g, user, now);
  }

  if ((await store.zCard(keys.active)) >= MAX_ACTIVE) {
    return { type: 'none', message: 'Every board is waiting on someone else. Check back soon!' };
  }
  const fresh = await createGame(store, now);
  const g = await tryReserve(store, user, fresh.id, now);
  if (!g) return { type: 'none', message: 'Could not reserve a board. Try again.' };
  return served(g, user, now);
};

const served = (g: GameRecord, user: string, now: number): NextGameResponse => ({
  type: 'game',
  game: toView(g, user),
  color: colorOfPly(g.moves.length + 1),
  lockExpiresAt: now + LOCK_MS,
});

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

export const applyMove = async (
  store: Store,
  user: string,
  req: MoveRequest,
  opts: { now?: number; requireLock?: boolean } = {}
): Promise<MoveResponse> => {
  const now = opts.now ?? Date.now();
  const requireLock = opts.requireLock ?? true;
  const g = await loadGame(store, req.gameId);
  if (!g) return { type: 'error', message: 'Game not found.' };
  if (g.status !== 'active') return { type: 'error', message: 'That game is already over.' };
  if (g.moves.length !== req.ply)
    return { type: 'error', message: 'Someone else moved first. Grab a new board!' };
  if (await store.hGet(keys.players(g.id), user))
    return { type: 'error', message: 'You already played a move in this game.' };
  if (requireLock && (await store.get(keys.lock(g.id))) !== user)
    return { type: 'error', message: 'Your reservation expired. Grab a new board!' };

  const parsed = parseUci(req.uci);
  if (!parsed) return { type: 'error', message: 'Malformed move.' };
  const chess = replay(g.moves);
  let san: string;
  try {
    san = chess.move(parsed).san;
  } catch {
    return { type: 'error', message: 'Illegal move.' };
  }

  // Atomically claim this ply so two racing requests cannot both land.
  const ply = g.moves.length + 1;
  if (!(await store.hSetNX(keys.plyClaims(g.id), String(ply), user)))
    return { type: 'error', message: 'Someone else moved first. Grab a new board!' };

  const move: MoveRecord = { ply, san, uci: req.uci, user, at: now };
  g.moves.push(move);
  g.fen = chess.fen();
  g.updatedAt = now;
  const end = detectEnd(chess, g.moves.length);
  if (end) {
    g.status = 'finished';
    g.result = end.result;
    g.reason = end.reason;
  }
  await saveGame(store, g);
  await store.hSet(keys.players(g.id), { [user]: String(ply) });
  await store.zAdd(keys.userGames(user), { member: g.id, score: now });
  await store.zAdd(keys.allUsers, { member: user, score: now });
  await store.hIncrBy(keys.userStats(user), 'pending', 1);
  await store.del(keys.lock(g.id));
  await store.del(keys.userCurrent(user));

  if (end) {
    await store.zRem(keys.active, [g.id]);
    await store.zAdd(keys.finished, { member: g.id, score: now });
    await settleGame(store, g);
  } else {
    await store.zAdd(keys.active, { member: g.id, score: now });
  }
  return { type: 'ok', game: toView(g, user), stats: await getStats(store, user) };
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const getHistory = async (
  store: Store,
  user: string,
  cursor = 0,
  limit = 20
): Promise<HistoryResponse> => {
  const rows = await store.zRange(keys.userGames(user), cursor, cursor + limit - 1, {
    by: 'rank',
    reverse: true,
  });
  const entries: HistoryEntry[] = [];
  for (const { member } of rows) {
    const g = await loadGame(store, member);
    const mine = g?.moves.find((m) => m.user === user);
    if (!g || !mine) continue;
    const color = colorOfPly(mine.ply);
    entries.push({
      gameId: g.id,
      color,
      san: mine.san,
      ply: mine.ply,
      playedAt: mine.at,
      status: g.status,
      result: g.result,
      reason: g.reason,
      totalPlies: g.moves.length,
      outcome: outcomeFor(color, g.result),
    });
  }
  return { entries, nextCursor: rows.length === limit ? cursor + limit : null };
};

/** Players may look at games they took part in, plus any finished game. */
export const getGameFor = async (
  store: Store,
  id: string,
  user: string
): Promise<GameView | null> => {
  const g = await loadGame(store, id);
  if (!g) return null;
  const participated = g.moves.some((m) => m.user === user);
  if (!participated && g.status !== 'finished') return null;
  return toView(g, user);
};

export const getLeaderboard = async (store: Store, limit = 25): Promise<LeaderboardResponse> => {
  const rows = await store.zRange(keys.leaderboard, 0, limit - 1, { by: 'rank', reverse: true });
  const entries = [];
  for (const [i, { member }] of rows.entries()) {
    const s = await store.hGetAll(keys.userStats(member));
    const wins = Number(s.wins ?? 0);
    const losses = Number(s.losses ?? 0);
    const draws = Number(s.draws ?? 0);
    entries.push({
      rank: i + 1,
      username: member,
      winRate: winRateOf(wins, losses, draws) ?? 0,
      wins,
      losses,
      draws,
    });
  }
  return { entries, minGames: LEADERBOARD_MIN_GAMES };
};
