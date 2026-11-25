export type Color = 'w' | 'b';

/** PGN-style result of a finished line. */
export type LineResult = '1-0' | '0-1' | '1/2-1/2';

export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move-rule'
  /** Line was still open at midnight; decided on material. */
  | 'adjudicated';

/** How the lines (leaves) below a node ended: white wins / draws / black wins. */
export type Outcome = { w: number; d: number; b: number };

export type OpeningInfo = { name: string; san: string[] };

/** A move on the path from the opening position to a node. */
export type LineMove = { san: string; uci: string };

export type Stats = {
  /** Moves from finished days. */
  moves: number;
  /** Average branch win rate of those moves, 0..100. null when there are none. */
  winRate: number | null;
  /** Moves played today, revealed at midnight UTC. */
  pending: number;
  rank: number | null;
};

export type MeResponse = {
  username: string;
  stats: Stats;
  isModerator: boolean;
  today: string;
  closesAt: number;
  /** Server's game clock (differs from real time only after the "advance day" test tool). */
  now: number;
};

export type ServedPosition = {
  day: string;
  nodeId: string;
  fen: string;
  color: Color;
  /** 1-based ply number of the move you are about to play (counted from the start of the game). */
  ply: number;
  opening: OpeningInfo;
  /** Moves played by the community after the opening, leading to this position. */
  line: LineMove[];
  /** How many moves have already been made from this exact position. */
  playedHere: number;
  closesAt: number;
};

export type NextResponse =
  | { type: 'position'; position: ServedPosition }
  | { type: 'none'; message: string; closesAt: number };

export type MoveRequest = { day: string; nodeId: string; uci: string };

export type MoveResponse =
  | {
      type: 'ok';
      san: string;
      ply: number;
      /** True when nobody had played this move from this position before. */
      newBranch: boolean;
      /** True when the move ended the line (mate, stalemate, draw rules). */
      ended: { result: LineResult; reason: EndReason } | null;
      stats: Stats;
    }
  | { type: 'error'; message: string };

export type MyMove = {
  /** Position the move was played from. */
  nodeId: string;
  uci: string;
  san: string;
  ply: number;
  color: Color;
  at: number;
  /** Lines below this move, filled in once the day is over. */
  out: Outcome | null;
  /** Share of those lines won by the side that played the move, 0..100. */
  winRate: number | null;
};

export type HistoryDay = {
  day: string;
  opening: OpeningInfo;
  closed: boolean;
  moves: MyMove[];
  /** Average win rate of the moves above (null while the day is open). */
  dayRate: number | null;
};

export type HistoryResponse = { days: HistoryDay[]; nextCursor: number | null };

export type ArchiveDay = {
  day: string;
  opening: OpeningInfo;
  closed: boolean;
  players: number;
  moves: number;
  myMoves: number;
};

export type ArchiveResponse = { days: ArchiveDay[] };

export type TreeNode = {
  id: string;
  parent: string | null;
  san: string;
  uci: string;
  ply: number;
  fen: string;
  /** Everyone who played the move leading into this node. */
  players: string[];
  out: Outcome;
  end: { result: LineResult; reason: EndReason } | null;
};

export type DayTreeResponse = {
  day: string;
  opening: OpeningInfo;
  startFen: string;
  nodes: TreeNode[];
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  winRate: number;
  moves: number;
};

export type LeaderboardResponse = { entries: LeaderboardEntry[]; minMoves: number };

export type ErrorResponse = { type: 'error'; message: string };

export const ROOT_ID = 'r';

export const parentOf = (id: string): string | null => {
  const i = id.lastIndexOf('.');
  return i === -1 ? null : id.slice(0, i);
};

/** True if `a` is `b` or one of its ancestors (node ids encode the path). */
export const isAncestorOrSelf = (a: string, b: string) => b === a || b.startsWith(`${a}.`);

export const colorOfPly = (ply: number): Color => (ply % 2 === 1 ? 'w' : 'b');

export const totalLines = (o: Outcome) => o.w + o.d + o.b;

/** Share of lines won by `color`, 0..100, or null when there are none. */
export const winRateFor = (o: Outcome, color: Color): number | null => {
  const t = totalLines(o);
  if (t === 0) return null;
  return ((color === 'w' ? o.w : o.b) / t) * 100;
};
