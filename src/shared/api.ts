export type Color = 'w' | 'b';

/** PGN-style result. `*` means the game is still running. */
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export type GameStatus = 'active' | 'finished';

export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move-rule'
  | 'move-limit';

export type MoveRecord = {
  ply: number; // 1-based: ply 1 is White's first move
  san: string;
  uci: string; // e.g. "e2e4", "e7e8q"
  user: string;
  at: number; // epoch ms
};

export type GameView = {
  id: string;
  status: GameStatus;
  result: GameResult;
  reason: EndReason | null;
  fen: string;
  moves: MoveRecord[];
  createdAt: number;
  updatedAt: number;
  /** The viewer's own move in this game, if any. */
  myMove: (MoveRecord & { color: Color }) | null;
};

export type Stats = {
  wins: number;
  losses: number;
  draws: number;
  /** Moves played in games that are still running. */
  pending: number;
  /** wins / finished games, 0..100. null when nothing has finished yet. */
  winRate: number | null;
  rank: number | null;
};

export type MeResponse = {
  username: string;
  stats: Stats;
  isModerator: boolean;
};

export type NextGameResponse =
  | { type: 'game'; game: GameView; color: Color; lockExpiresAt: number }
  | { type: 'none'; message: string };

export type MoveRequest = {
  gameId: string;
  /** Number of plies the client saw. Guards against stale boards. */
  ply: number;
  uci: string;
};

export type MoveResponse =
  | { type: 'ok'; game: GameView; stats: Stats }
  | { type: 'error'; message: string };

export type HistoryEntry = {
  gameId: string;
  color: Color;
  san: string;
  ply: number;
  playedAt: number;
  status: GameStatus;
  result: GameResult;
  reason: EndReason | null;
  totalPlies: number;
  /** From the viewer's point of view. null while the game is running. */
  outcome: 'win' | 'loss' | 'draw' | null;
};

export type HistoryResponse = {
  entries: HistoryEntry[];
  nextCursor: number | null;
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  winRate: number;
  wins: number;
  losses: number;
  draws: number;
};

export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
  minGames: number;
};

export type ErrorResponse = { type: 'error'; message: string };

export const outcomeFor = (
  color: Color,
  result: GameResult
): 'win' | 'loss' | 'draw' | null => {
  if (result === '*') return null;
  if (result === '1/2-1/2') return 'draw';
  const whiteWon = result === '1-0';
  return (color === 'w') === whiteWon ? 'win' : 'loss';
};

export const colorOfPly = (ply: number): Color => (ply % 2 === 1 ? 'w' : 'b');
