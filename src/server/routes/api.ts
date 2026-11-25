import { Hono } from 'hono';
import type {
  ErrorResponse,
  MeResponse,
  MoveRequest,
  MoveResponse,
  NextGameResponse,
} from '../../shared/api.ts';
import {
  applyMove,
  getGameFor,
  getHistory,
  getLeaderboard,
  getStats,
  nextGame,
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

export const createApi = (env: Env) => {
  const api = new Hono();

  const needUser = async () => {
    const u = await env.username();
    if (!u) throw new HttpError(401, 'Log in to play.');
    return u;
  };

  api.onError((err, c) => {
    if (err instanceof HttpError)
      return c.json<ErrorResponse>({ type: 'error', message: err.message }, err.status);
    console.error('API error', err);
    return c.json<ErrorResponse>({ type: 'error', message: 'Something went wrong.' }, 500);
  });

  api.get('/me', async (c) => {
    const username = await needUser();
    return c.json<MeResponse>({
      username,
      stats: await getStats(env.store, username),
      isModerator: await env.isModerator(),
    });
  });

  api.post('/next', async (c) => {
    const user = await needUser();
    const body = await c.req.json<{ skip?: boolean }>().catch(() => ({ skip: false }));
    return c.json<NextGameResponse>(await nextGame(env.store, user, { skip: !!body.skip }));
  });

  api.post('/move', async (c) => {
    const user = await needUser();
    const body = await c.req.json<MoveRequest>();
    if (typeof body.gameId !== 'string' || typeof body.uci !== 'string' || typeof body.ply !== 'number')
      throw new HttpError(400, 'Bad request.');
    const res = await applyMove(env.store, user, body);
    return c.json<MoveResponse>(res, res.type === 'ok' ? 200 : 409);
  });

  api.get('/history', async (c) => {
    const user = await needUser();
    const cursor = Number(c.req.query('cursor') ?? 0) || 0;
    return c.json(await getHistory(env.store, user, cursor));
  });

  api.get('/game/:id', async (c) => {
    const user = await needUser();
    const g = await getGameFor(env.store, c.req.param('id'), user);
    if (!g) throw new HttpError(404, 'You can only view games you played in, or finished games.');
    return c.json(g);
  });

  api.get('/leaderboard', async (c) => c.json(await getLeaderboard(env.store)));

  // --- Testing helpers (moderators only) ----------------------------------
  const needMod = async () => {
    const user = await needUser();
    if (!(await env.isModerator())) throw new HttpError(403, 'Moderators only.');
    return user;
  };

  api.post('/dev/seed', async (c) => {
    const user = await needMod();
    return c.json(await seedDemoData(env.store, { realUser: user, seed: Date.now() }));
  });

  api.post('/dev/simulate', async (c) => {
    await needMod();
    const body = await c.req.json<{ count?: number }>().catch(() => ({ count: 30 }));
    const count = Math.max(1, Math.min(200, Number(body.count ?? 30)));
    return c.json(await simulateBotMoves(env.store, count));
  });

  api.post('/dev/reset', async (c) => {
    await needMod();
    return c.json(await resetAllData(env.store));
  });

  return api;
};

export class HttpError extends Error {
  status: 400 | 401 | 403 | 404 | 409;
  constructor(status: 400 | 401 | 403 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}
