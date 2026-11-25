import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, reddit, redis } from '@devvit/web/server';
import { createPost } from '../core/post.ts';
import { resetAllData, seedDemoData, simulateBotMoves } from '../core/bots.ts';

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
  const r = await seedDemoData(redis, { realUser: user, seed: Date.now() });
  return c.json<UiResponse>({
    showToast: `Seeded ${r.games} games (${r.finished} finished, ${r.players} players)`,
  });
});

menu.post('/simulate', async (c) => {
  const r = await simulateBotMoves(redis, 40);
  return c.json<UiResponse>({
    showToast: `Bots played ${r.played} moves, ${r.finished} games finished`,
  });
});

menu.post('/reset', async (c) => {
  const r = await resetAllData(redis);
  return c.json<UiResponse>({ showToast: `Deleted ${r.games} games, ${r.users} players` });
});
