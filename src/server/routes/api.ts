import { Hono } from 'hono';
import type {
  ArchiveResponse,
  DayTreeResponse,
  ErrorResponse,
  HistoryResponse,
  LeaderboardResponse,
  MeResponse,
  MoveRequest,
  MoveResponse,
  NextResponse,
} from '../../shared/api.ts';
import { dayEndsAt, dayOf } from '../../shared/openings.ts';
import {
  closeFinishedDays,
  getArchive,
  getDayTree,
  getHistory,
  getLeaderboard,
  getMyDay,
  getNow,
  getStats,
  keys,
  nextPosition,
  playMove,
} from '../core/game.ts';
import { resetAllData, seedDemoData, simulateBotMoves } from '../core/bots.ts';
import type { Store } from '../core/store.ts';

/** What the routes need from the host (Devvit or the local dev server). */
export type Env = {
  store: Store;
  /** Current user's name, or null when logged out. */
  username: () => Promise<string | null>;
  isModerator: () => Promise<boolean>;
};

export class HttpError extends Error {
  status: 400 | 401 | 403 | 404 | 409;
  constructor(status: 400 | 401 | 403 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

export const createApi = (env: Env) => {
  const api = new Hono();
  const { store } = env;

  const needUser = async () => {
    const u = await env.username();
    if (!u) throw new HttpError(401, 'Log in to play.');
    return u;
  };
  const needMod = async () => {
    const user = await needUser();
    if (!(await env.isModerator())) throw new HttpError(403, 'Moderators only.');
    return user;
  };
  /** Current time; also closes any day that ended (backup for the midnight job). */
  const clock = async () => {
    const now = await getNow(store);
    await closeFinishedDays(store, now);
    return now;
  };

  api.onError((err, c) => {
    if (err instanceof HttpError)
      return c.json<ErrorResponse>({ type: 'error', message: err.message }, err.status);
    console.error('API error', err);
    return c.json<ErrorResponse>({ type: 'error', message: 'Something went wrong.' }, 500);
  });

  api.get('/me', async (c) => {
    const username = await needUser();
    const now = await clock();
    const today = dayOf(now);
    return c.json<MeResponse>({
      username,
      stats: await getStats(store, username),
      isModerator: await env.isModerator(),
      today,
      closesAt: dayEndsAt(today),
      now,
    });
  });

  api.post('/next', async (c) => {
    const user = await needUser();
    const now = await clock();
    const body = await c.req.json<{ skip?: boolean }>().catch(() => ({ skip: false }));
    return c.json<NextResponse>(await nextPosition(store, user, { skip: !!body.skip, now }));
  });

  api.post('/move', async (c) => {
    const user = await needUser();
    const now = await clock();
    const body = await c.req.json<MoveRequest>();
    if (typeof body.day !== 'string' || typeof body.nodeId !== 'string' || typeof body.uci !== 'string')
      throw new HttpError(400, 'Bad request.');
    const res = await playMove(store, user, body, { now });
    return c.json<MoveResponse>(res, res.type === 'ok' ? 200 : 409);
  });

  api.get('/history', async (c) => {
    const user = await needUser();
    await clock();
    const cursor = Number(c.req.query('cursor') ?? 0) || 0;
    return c.json<HistoryResponse>(await getHistory(store, user, cursor));
  });

  api.get('/days', async (c) => {
    const user = await needUser();
    await clock();
    return c.json<ArchiveResponse>(await getArchive(store, user));
  });

  api.get('/day/:day/mine', async (c) => {
    const user = await needUser();
    await clock();
    return c.json(await getMyDay(store, user, c.req.param('day')));
  });

  api.get('/day/:day/tree', async (c) => {
    await needUser();
    await clock();
    const tree = await getDayTree(store, c.req.param('day'));
    if (!tree) throw new HttpError(404, 'The tree is revealed once the day is over.');
    return c.json<DayTreeResponse>(tree);
  });

  api.get('/leaderboard', async (c) => {
    await clock();
    return c.json<LeaderboardResponse>(await getLeaderboard(store));
  });

  // --- Testing helpers (moderators only) ----------------------------------

  api.post('/dev/seed', async (c) => {
    const user = await needMod();
    const now = await clock();
    return c.json(await seedDemoData(store, { realUser: user, seed: Date.now(), now }));
  });

  api.post('/dev/simulate', async (c) => {
    await needMod();
    const now = await clock();
    const body = await c.req.json<{ count?: number }>().catch(() => ({ count: 30 }));
    const count = Math.max(1, Math.min(200, Number(body.count ?? 30)));
    return c.json(await simulateBotMoves(store, count, { now }));
  });

  /** Moves this subreddit's game clock forward one day, closing today. */
  api.post('/dev/advance-day', async (c) => {
    await needMod();
    await store.incrBy(keys.clockOffset, 1);
    const now = await getNow(store);
    const closed = await closeFinishedDays(store, now);
    return c.json({ today: dayOf(now), closed });
  });

  api.post('/dev/reset', async (c) => {
    await needMod();
    return c.json(await resetAllData(store));
  });

  return api;
};
