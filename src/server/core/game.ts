import { Chess } from 'chess.js';
import type {
  ArchiveResponse,
  DayTreeResponse,
  EndReason,
  HistoryDay,
  HistoryResponse,
  LeaderboardResponse,
  LineMove,
  LineResult,
  MoveRequest,
  MoveResponse,
  MyMove,
  NextResponse,
  Outcome,
  ServedPosition,
  Stats,
  TreeNode,
} from '../../shared/api.ts';
import { colorOfPly, isAncestorOrSelf, parentOf, ROOT_ID, winRateFor } from '../../shared/api.ts';
import { dayEndsAt, dayOf, openingFor } from '../../shared/openings.ts';
import type { Store } from './store.ts';

/**
 * How the daily tree works
 * ------------------------
 * Every UTC day has one game. It starts from the final position of that day's
 * opening (the root node). A node is a position, and its id is the path of
 * UCI moves from the root, e.g. "r.e2e4.c7c5". Players are handed positions.
 * When two players make the same move from the same position they land on the
 * same child node. Different moves create branches.
 *
 * A player can make many moves in a day, but never two on the same path: a
 * position is only offered if none of your earlier positions that day is its
 * ancestor or its descendant.
 *
 * At midnight UTC the day closes. Every leaf is scored (the real result if
 * the line ended, otherwise decided on material), the results are summed up
 * the tree, and each move is credited with the win rate of the lines under it
 * for the side that played it.
 */

/** A position stays open until this many moves have been made from it. */
export const MAX_VISITS = 3;
/** Reloading returns the same position for this long (stops cherry-picking). */
export const SERVE_MS = 15 * 60_000;
/** Moves from finished days needed to appear on the leaderboard. */
export const LEADERBOARD_MIN_MOVES = 5;
/** Material lead (pawn = 1) that wins an unfinished line at midnight. */
export const ADJUDICATION_MARGIN = 3;

const DAY_MS = 86_400_000;

export const keys = {
  dayNodes: (d: string) => `day:${d}:nodes`,
  dayPlays: (d: string) => `day:${d}:plays`,
  dayOpen: (d: string) => `day:${d}:open`,
  dayMeta: (d: string) => `day:${d}:meta`,
  dayUsers: (d: string) => `day:${d}:users`,
  dayTree: (d: string) => `day:${d}:tree`,
  daysAll: 'days:all',
  daysActive: 'days:active',
  daysClosed: 'days:closed',
  userDay: (u: string, d: string) => `user:${u}:day:${d}`,
  userDays: (u: string) => `user:${u}:days`,
  userStats: (u: string) => `user:${u}:stats`,
  userCurrent: (u: string) => `user:${u}:current`,
  allUsers: 'users:all',
  leaderboard: 'leaderboard',
  clockOffset: 'debug:clock-offset-days',
};

type NodeRec = {
  fen: string;
  san: string;
  uci: string;
  /** Ply of the move that led here (opening moves included). */
  ply: number;
  at: number;
  end: { result: LineResult; reason: EndReason } | null;
};

type UserPlay = { uci: string; san: string; ply: number; at: number; out?: Outcome };

const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Current time, shifted by the moderator "advance day" test tool. */
export const getNow = async (store: Store) =>
  Date.now() + Number((await store.get(keys.clockOffset)) ?? 0) * DAY_MS;

// ---------------------------------------------------------------------------
// Chess helpers
// ---------------------------------------------------------------------------

const startFens = new Map<string, string>();
export const startFenFor = (day: string): string => {
  const opening = openingFor(day);
  let fen = startFens.get(opening.name);
  if (!fen) {
    const c = new Chess();
    for (const san of opening.san) c.move(san);
    fen = c.fen();
    startFens.set(opening.name, fen);
  }
  return fen;
};

export const parseUci = (uci: string) => {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!m) return null;
  const move: { from: string; to: string; promotion?: string } = { from: m[1]!, to: m[2]! };
  if (m[3]) move.promotion = m[3];
  return move;
};

/** Replays opening + path so repetition rules see the whole game. */
export const replayTo = (day: string, nodeId: string): Chess => {
  const c = new Chess();
  for (const san of openingFor(day).san) c.move(san);
  for (const uci of nodeId.split('.').slice(1)) {
    const p = parseUci(uci);
    if (!p) throw new Error(`corrupt node id ${nodeId}`);
    c.move(p);
  }
  return c;
};

export const detectEnd = (chess: Chess): NodeRec['end'] => {
  if (chess.isCheckmate())
    return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient-material' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'threefold-repetition' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'fifty-move-rule' };
  return null;
};

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Decides a line that was still open at midnight: plain material count. */
export const adjudicate = (fen: string): LineResult => {
  let diff = 0;
  for (const ch of fen.split(' ')[0]!) {
    const v = VALUE[ch.toLowerCase()];
    if (v) diff += ch === ch.toUpperCase() ? v : -v;
  }
  if (diff >= ADJUDICATION_MARGIN) return '1-0';
  if (diff <= -ADJUDICATION_MARGIN) return '0-1';
  return '1/2-1/2';
};

const depthOf = (id: string) => id.split('.').length - 1;

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const ensureDay = async (store: Store, d: string, now: number) => {
  const root: NodeRec = {
    fen: startFenFor(d),
    san: '',
    uci: '',
    ply: openingFor(d).san.length,
    at: now,
    end: null,
  };
  if (await store.hSetNX(keys.dayNodes(d), ROOT_ID, JSON.stringify(root))) {
    await store.zAdd(keys.dayOpen(d), { member: ROOT_ID, score: 0 });
    await store.zAdd(keys.daysAll, { member: d, score: dayStart(d) });
    await store.zAdd(keys.daysActive, { member: d, score: dayStart(d) });
  }
};

const isClosed = async (store: Store, d: string) => !!(await store.hGet(keys.daysClosed, d));

/** Builds the scored tree for a day from its raw nodes and plays. */
export const buildTree = (
  nodes: Record<string, string>,
  plays: Record<string, string>
): TreeNode[] => {
  const recs = new Map<string, NodeRec>();
  for (const [id, json] of Object.entries(nodes)) recs.set(id, JSON.parse(json) as NodeRec);
  const children = new Map<string, string[]>();
  for (const id of recs.keys()) {
    const p = parentOf(id);
    if (p) children.set(p, [...(children.get(p) ?? []), id]);
  }
  const players = new Map<string, string[]>();
  for (const [field, uci] of Object.entries(plays)) {
    const bar = field.indexOf('|');
    const child = `${field.slice(bar + 1)}.${uci}`;
    players.set(child, [...(players.get(child) ?? []), field.slice(0, bar)]);
  }

  const out = new Map<string, Outcome>();
  const ends = new Map<string, TreeNode['end']>();
  const ids = [...recs.keys()].sort((a, b) => depthOf(b) - depthOf(a));
  for (const id of ids) {
    const rec = recs.get(id)!;
    const kids = children.get(id);
    if (!kids?.length) {
      // A leaf: a finished line, or one decided on material.
      const end = rec.end ?? { result: adjudicate(rec.fen), reason: 'adjudicated' as const };
      ends.set(id, end);
      out.set(id, {
        w: end.result === '1-0' ? 1 : 0,
        d: end.result === '1/2-1/2' ? 1 : 0,
        b: end.result === '0-1' ? 1 : 0,
      });
    } else {
      const sum = { w: 0, d: 0, b: 0 };
      for (const k of kids) {
        const o = out.get(k)!;
        sum.w += o.w;
        sum.d += o.d;
        sum.b += o.b;
      }
      out.set(id, sum);
      ends.set(id, null);
    }
  }
  return ids.reverse().map((id) => {
    const rec = recs.get(id)!;
    return {
      id,
      parent: parentOf(id),
      san: rec.san,
      uci: rec.uci,
      ply: rec.ply,
      fen: rec.fen,
      players: players.get(id) ?? [],
      out: out.get(id)!,
      end: ends.get(id) ?? null,
    };
  });
};

/** Scores a finished day and credits every player. Safe to call twice. */
export const closeDay = async (store: Store, d: string, now = Date.now()) => {
  if (!(await store.hSetNX(keys.daysClosed, d, String(now)))) return false;
  const tree = buildTree(
    await store.hGetAll(keys.dayNodes(d)),
    await store.hGetAll(keys.dayPlays(d))
  );
  await store.set(keys.dayTree(d), JSON.stringify(tree));
  const byId = new Map(tree.map((n) => [n.id, n]));

  // Group credits per player so each one costs a handful of writes.
  const perUser = new Map<string, { moves: number; milli: number }>();
  for (const n of tree) {
    for (const user of n.players) {
      const rate = winRateFor(n.out, colorOfPly(n.ply)) ?? 0;
      const t = perUser.get(user) ?? { moves: 0, milli: 0 };
      t.moves++;
      t.milli += Math.round(rate * 1000);
      perUser.set(user, t);
    }
  }
  for (const [user, t] of perUser) {
    const dayKey = keys.userDay(user, d);
    const mine = await store.hGetAll(dayKey);
    const updated: Record<string, string> = {};
    for (const [pos, json] of Object.entries(mine)) {
      const play = JSON.parse(json) as UserPlay;
      const child = byId.get(`${pos}.${play.uci}`);
      if (child) updated[pos] = JSON.stringify({ ...play, out: child.out });
    }
    if (Object.keys(updated).length) await store.hSet(dayKey, updated);
    const sk = keys.userStats(user);
    await store.hIncrBy(sk, 'moves', t.moves);
    await store.hIncrBy(sk, 'winMilli', t.milli);
    await store.hIncrBy(sk, 'pending', -t.moves);
    await refreshLeaderboard(store, user);
  }
  await store.zRem(keys.daysActive, [d]);
  await store.del(keys.dayOpen(d));
  return true;
};

/** Closes every day before today that has not been closed yet. */
export const closeFinishedDays = async (store: Store, now: number) => {
  const today = dayOf(now);
  const closed: string[] = [];
  for (const { member } of await store.zRange(keys.daysActive, 0, -1, { by: 'rank' })) {
    if (member < today && (await closeDay(store, member, now))) closed.push(member);
  }
  return closed;
};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const getStats = async (store: Store, user: string): Promise<Stats> => {
  const h = await store.hGetAll(keys.userStats(user));
  const moves = Number(h.moves ?? 0);
  const milli = Number(h.winMilli ?? 0);
  let rank: number | null = null;
  const asc = await store.zRank(keys.leaderboard, user);
  if (asc !== undefined) rank = (await store.zCard(keys.leaderboard)) - asc;
  return {
    moves,
    winRate: moves ? milli / 1000 / moves : null,
    pending: Number(h.pending ?? 0),
    rank,
  };
};

export const refreshLeaderboard = async (store: Store, user: string) => {
  const s = await getStats(store, user);
  if (s.moves < LEADERBOARD_MIN_MOVES || s.winRate === null) return;
  await store.zAdd(keys.leaderboard, {
    member: user,
    score: Math.round(s.winRate * 100) * 100_000 + Math.min(s.moves, 99_999),
  });
};

// ---------------------------------------------------------------------------
// Serving positions
// ---------------------------------------------------------------------------

const servePosition = async (
  store: Store,
  d: string,
  id: string
): Promise<ServedPosition | null> => {
  const raw = await store.hGet(keys.dayNodes(d), id);
  if (!raw) return null;
  const rec = JSON.parse(raw) as NodeRec;
  const segs = id.split('.');
  // Every node on the path below the root ("r.a", "r.a.b", ... , id).
  const pathIds = segs.slice(1).map((_, i) => segs.slice(0, i + 2).join('.'));
  const recs = pathIds.length ? await store.hMGet(keys.dayNodes(d), pathIds) : [];
  const line: LineMove[] = recs.map((r, i) => {
    const n = r ? (JSON.parse(r) as NodeRec) : null;
    return { san: n?.san ?? '?', uci: n?.uci ?? segs[i + 1]! };
  });
  return {
    day: d,
    nodeId: id,
    fen: rec.fen,
    color: colorOfPly(rec.ply + 1),
    ply: rec.ply + 1,
    opening: openingFor(d),
    line,
    playedHere: (await store.zScore(keys.dayOpen(d), id)) ?? MAX_VISITS,
    closesAt: dayEndsAt(d),
  };
};

const pickWeighted = <T>(items: { item: T; weight: number }[], rand: () => number): T | null => {
  const total = items.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const x of items) {
    r -= x.weight;
    if (r <= 0) return x.item;
  }
  return items[items.length - 1]!.item;
};

/**
 * Hands a player a position from today's tree. Positions nobody has moved
 * from yet are preferred, deeper ones a bit more, but already-played positions
 * are offered too so the tree keeps branching.
 */
export const nextPosition = async (
  store: Store,
  user: string,
  opts: { skip?: boolean; now?: number; rand?: () => number } = {}
): Promise<NextResponse> => {
  const now = opts.now ?? Date.now();
  const rand = opts.rand ?? Math.random;
  const d = dayOf(now);
  await ensureDay(store, d, now);

  const played = Object.keys(await store.hGetAll(keys.userDay(user, d)));
  const eligible = (x: string) =>
    !played.some((p) => isAncestorOrSelf(p, x) || isAncestorOrSelf(x, p));

  let exclude: string | null = null;
  const current = await store.get(keys.userCurrent(user));
  if (current) {
    const [cd, cid] = current.split('|');
    if (opts.skip) {
      exclude = cd === d ? (cid ?? null) : null;
      await store.del(keys.userCurrent(user));
    } else if (
      cd === d &&
      cid &&
      eligible(cid) &&
      (await store.zScore(keys.dayOpen(d), cid)) !== undefined
    ) {
      const p = await servePosition(store, d, cid);
      if (p) return { type: 'position', position: p };
    }
  }

  const open = await store.zRange(keys.dayOpen(d), 0, 299, { by: 'rank' });
  let options = open.filter((o) => eligible(o.member) && o.member !== exclude);
  if (!options.length) options = open.filter((o) => eligible(o.member));
  const pick = pickWeighted(
    options.map((o) => ({
      item: o.member,
      weight: (o.score === 0 ? 3 : 1) * (1 + depthOf(o.member) / 8),
    })),
    rand
  );
  if (!pick) {
    return {
      type: 'none',
      closesAt: dayEndsAt(d),
      message: played.length
        ? "Every open position today is on a path you've already played. New branches appear as others play, so check back later!"
        : 'No open positions right now. Check back soon!',
    };
  }
  await store.set(keys.userCurrent(user), `${d}|${pick}`, {
    expiration: new Date(Date.now() + SERVE_MS),
  });
  const p = await servePosition(store, d, pick);
  return p
    ? { type: 'position', position: p }
    : { type: 'none', message: 'Could not load a position.', closesAt: dayEndsAt(d) };
};

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

export const playMove = async (
  store: Store,
  user: string,
  req: MoveRequest,
  opts: { now?: number } = {}
): Promise<MoveResponse> => {
  const now = opts.now ?? Date.now();
  const d = dayOf(now);
  if (req.day !== d) return { type: 'error', message: "That day's game is over. Here's today's!" };
  if ((await store.get(keys.userCurrent(user))) !== `${d}|${req.nodeId}`)
    return { type: 'error', message: 'This position is no longer reserved for you. Grab a new one!' };

  const dayKey = keys.userDay(user, d);
  const played = Object.keys(await store.hGetAll(dayKey));
  if (played.some((p) => isAncestorOrSelf(p, req.nodeId) || isAncestorOrSelf(req.nodeId, p)))
    return { type: 'error', message: "You've already played on this path today." };

  const raw = await store.hGet(keys.dayNodes(d), req.nodeId);
  if (!raw) return { type: 'error', message: 'Position not found.' };
  const parent = JSON.parse(raw) as NodeRec;
  if (parent.end) return { type: 'error', message: 'This line has already ended.' };

  const parsed = parseUci(req.uci);
  if (!parsed) return { type: 'error', message: 'Malformed move.' };
  const chess = replayTo(d, req.nodeId);
  let san: string;
  let uci: string;
  try {
    const mv = chess.move(parsed);
    san = mv.san;
    uci = `${mv.from}${mv.to}${mv.promotion ?? ''}`;
  } catch {
    return { type: 'error', message: 'Illegal move.' };
  }

  const ply = parent.ply + 1;
  const mine: UserPlay = { uci, san, ply, at: now };
  if (!(await store.hSetNX(dayKey, req.nodeId, JSON.stringify(mine))))
    return { type: 'error', message: "You've already played this position." };

  const childId = `${req.nodeId}.${uci}`;
  const end = detectEnd(chess);
  const child: NodeRec = { fen: chess.fen(), san, uci, ply, at: now, end };
  const created = await store.hSetNX(keys.dayNodes(d), childId, JSON.stringify(child));
  await store.hSet(keys.dayPlays(d), { [`${user}|${req.nodeId}`]: uci });

  const openKey = keys.dayOpen(d);
  if ((await store.zScore(openKey, req.nodeId)) !== undefined) {
    const visits = await store.zIncrBy(openKey, req.nodeId, 1);
    if (visits >= MAX_VISITS) await store.zRem(openKey, [req.nodeId]);
  }
  if (created && !end) await store.zAdd(openKey, { member: childId, score: 0 });

  await store.hIncrBy(keys.dayMeta(d), 'moves', 1);
  if (await store.hSetNX(keys.dayUsers(d), user, '1'))
    await store.hIncrBy(keys.dayMeta(d), 'players', 1);
  await store.hIncrBy(keys.userStats(user), 'pending', 1);
  await store.zAdd(keys.userDays(user), { member: d, score: dayStart(d) });
  await store.zAdd(keys.allUsers, { member: user, score: now });
  await store.del(keys.userCurrent(user));

  return {
    type: 'ok',
    san,
    ply,
    newBranch: !!created,
    ended: end,
    stats: await getStats(store, user),
  };
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const myMovesFor = async (store: Store, user: string, d: string): Promise<MyMove[]> => {
  const h = await store.hGetAll(keys.userDay(user, d));
  return Object.entries(h)
    .map(([nodeId, json]) => {
      const p = JSON.parse(json) as UserPlay;
      const color = colorOfPly(p.ply);
      return {
        nodeId,
        uci: p.uci,
        san: p.san,
        ply: p.ply,
        color,
        at: p.at,
        out: p.out ?? null,
        winRate: p.out ? winRateFor(p.out, color) : null,
      };
    })
    .sort((a, b) => b.at - a.at);
};

export const getHistory = async (
  store: Store,
  user: string,
  cursor = 0,
  limit = 10
): Promise<HistoryResponse> => {
  const rows = await store.zRange(keys.userDays(user), cursor, cursor + limit - 1, {
    by: 'rank',
    reverse: true,
  });
  const days: HistoryDay[] = [];
  for (const { member: d } of rows) days.push(await getMyDay(store, user, d));
  return { days, nextCursor: rows.length === limit ? cursor + limit : null };
};

export const getMyDay = async (store: Store, user: string, d: string): Promise<HistoryDay> => {
  const moves = await myMovesFor(store, user, d);
  const closed = await isClosed(store, d);
  const rated = moves.filter((m) => m.winRate !== null);
  return {
    day: d,
    opening: openingFor(d),
    closed,
    moves,
    dayRate:
      closed && rated.length ? rated.reduce((sum, m) => sum + (m.winRate ?? 0), 0) / rated.length : null,
  };
};

export const getArchive = async (store: Store, user: string, limit = 30): Promise<ArchiveResponse> => {
  const rows = await store.zRange(keys.daysAll, 0, limit - 1, { by: 'rank', reverse: true });
  const days = [];
  for (const { member: d } of rows) {
    const meta = await store.hGetAll(keys.dayMeta(d));
    days.push({
      day: d,
      opening: openingFor(d),
      closed: await isClosed(store, d),
      players: Number(meta.players ?? 0),
      moves: Number(meta.moves ?? 0),
      myMoves: Object.keys(await store.hGetAll(keys.userDay(user, d))).length,
    });
  }
  return { days };
};

/** The full tree is only revealed once the day is over. */
export const getDayTree = async (store: Store, d: string): Promise<DayTreeResponse | null> => {
  if (!(await isClosed(store, d))) return null;
  const raw = await store.get(keys.dayTree(d));
  if (!raw) return null;
  return {
    day: d,
    opening: openingFor(d),
    startFen: startFenFor(d),
    nodes: JSON.parse(raw) as TreeNode[],
  };
};

export const getLeaderboard = async (store: Store, limit = 25): Promise<LeaderboardResponse> => {
  const rows = await store.zRange(keys.leaderboard, 0, limit - 1, { by: 'rank', reverse: true });
  const entries = [];
  for (const [i, { member }] of rows.entries()) {
    const s = await getStats(store, member);
    entries.push({ rank: i + 1, username: member, winRate: s.winRate ?? 0, moves: s.moves });
  }
  return { entries, minMoves: LEADERBOARD_MIN_MOVES };
};
