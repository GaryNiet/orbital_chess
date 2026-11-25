import type {
  GameView,
  HistoryResponse,
  LeaderboardResponse,
  MeResponse,
  MoveResponse,
  NextGameResponse,
} from '../shared/api';

export class ApiError extends Error {}

const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok && !(res.status === 409 && body)) {
    const msg =
      body && typeof body === 'object' && 'message' in body ? String(body.message) : `HTTP ${res.status}`;
    throw new ApiError(msg);
  }
  return body as T;
};

const post = <T,>(path: string, body: unknown = {}) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  me: () => call<MeResponse>('/me'),
  next: (skip = false) => post<NextGameResponse>('/next', { skip }),
  move: (gameId: string, ply: number, uci: string) =>
    post<MoveResponse>('/move', { gameId, ply, uci }),
  history: (cursor = 0) => call<HistoryResponse>(`/history?cursor=${cursor}`),
  game: (id: string) => call<GameView>(`/game/${encodeURIComponent(id)}`),
  leaderboard: () => call<LeaderboardResponse>('/leaderboard'),
  seed: () => post<{ games: number; finished: number; players: number }>('/dev/seed'),
  simulate: (count: number) => post<{ played: number; finished: number }>('/dev/simulate', { count }),
  reset: () => post<{ games: number; users: number }>('/dev/reset'),
};
