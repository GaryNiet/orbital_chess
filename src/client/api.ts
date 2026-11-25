import type {
  ArchiveResponse,
  DayTreeResponse,
  HistoryDay,
  LeaderboardResponse,
  MeResponse,
  MoveResponse,
  NextResponse,
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
  next: (skip = false) => post<NextResponse>('/next', { skip }),
  move: (day: string, nodeId: string, uci: string) => post<MoveResponse>('/move', { day, nodeId, uci }),
  days: () => call<ArchiveResponse>('/days'),
  myDay: (day: string) => call<HistoryDay>(`/day/${day}/mine`),
  tree: (day: string) => call<DayTreeResponse>(`/day/${day}/tree`),
  leaderboard: () => call<LeaderboardResponse>('/leaderboard'),
  seed: () => post<{ days: number; moves: number }>('/dev/seed'),
  simulate: (count: number) => post<{ played: number }>('/dev/simulate', { count }),
  advanceDay: () => post<{ today: string; closed: string[] }>('/dev/advance-day'),
  reset: () => post<{ days: number; users: number }>('/dev/reset'),
};
