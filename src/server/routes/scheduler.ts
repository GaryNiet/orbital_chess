import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import { closeFinishedDays, getNow } from '../core/game.ts';

export const scheduler = new Hono();

/** Runs at 00:01 UTC: scores yesterday's tree and credits every player. */
scheduler.post('/close-day', async (c) => {
  const closed = await closeFinishedDays(redis, await getNow(redis));
  console.log(`close-day: closed ${closed.join(', ') || 'nothing'}`);
  return c.json({ status: 'ok', closed });
});
