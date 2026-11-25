import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, reddit, redis } from '@devvit/web/server';
import { createPost } from '../core/post.ts';
import { resetAllData, seedDemoData, simulateBotMoves } from '../core/bots.ts';
import { closeFinishedDays, getNow, keys } from '../core/game.ts';
import { dayOf } from '../../shared/openings.ts';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();
    return c.json<UiResponse>({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

menu.post('/seed', async (c) => {
  const user = (await reddit.getCurrentUsername()) ?? null;
  const now = await getNow(redis);
  await closeFinishedDays(redis, now);
  const r = await seedDemoData(redis, { realUser: user, seed: Date.now(), now });
  return c.json<UiResponse>({ showToast: `Seeded ${r.days} days with ${r.moves} moves` });
});

menu.post('/simulate', async (c) => {
  const now = await getNow(redis);
  await closeFinishedDays(redis, now);
  const r = await simulateBotMoves(redis, 40, { now });
  return c.json<UiResponse>({ showToast: `Bots played ${r.played} moves on today's tree` });
});

menu.post('/advance-day', async (c) => {
  await redis.incrBy(keys.clockOffset, 1);
  const now = await getNow(redis);
  const closed = await closeFinishedDays(redis, now);
  return c.json<UiResponse>({
    showToast: `Game clock is now ${dayOf(now)}; revealed ${closed.join(', ') || 'nothing'}`,
  });
});

menu.post('/reset', async (c) => {
  const r = await resetAllData(redis);
  return c.json<UiResponse>({ showToast: `Deleted ${r.days} days, ${r.users} players` });
});
