/**
 * Local stand-in for the Devvit backend: the same Hono API, backed by an
 * in-memory store and pre-seeded with fake games. Pick who you are with
 * `?user=name` in the page URL (stored in a cookie); defaults to "you".
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { getCookie } from 'hono/cookie';
import { createApi } from '../../src/server/routes/api.ts';
import { MemoryStore } from '../../src/server/core/store.ts';
import { seedDemoData } from '../../src/server/core/bots.ts';

export const startApiServer = async (port: number) => {
  const store = new MemoryStore();
  const t = Date.now();
  const r = await seedDemoData(store, { realUser: 'you', games: 24, seed: 42 });
  console.log(`[local] seeded ${r.games} games (${r.finished} finished) in ${Date.now() - t}ms`);

  let currentUser = 'you';
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    currentUser = getCookie(c, 'oc_user') || 'you';
    await next();
  });
  app.route(
    '/api',
    createApi({ store, username: async () => currentUser, isModerator: async () => true })
  );
  serve({ fetch: app.fetch, port });
  console.log(`[local] API on http://localhost:${port}`);
};
