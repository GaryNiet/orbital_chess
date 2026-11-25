import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import { createApi } from './routes/api.ts';
import { menu } from './routes/menu.ts';
import { triggers } from './routes/triggers.ts';

const isModerator = async () => {
  try {
    const user = await reddit.getCurrentUser();
    if (!user || !context.subredditName) return false;
    const perms = await user.getModPermissionsForSubreddit(context.subredditName);
    return perms.length > 0;
  } catch (err) {
    console.error('mod check failed', err);
    return false;
  }
};

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/triggers', triggers);

app.route(
  '/api',
  createApi({
    store: redis,
    username: async () => (await reddit.getCurrentUsername()) ?? null,
    isModerator,
  })
);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
