import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { startApiServer } from './server.ts';

const API_PORT = 8787;
const WEB_PORT = Number(process.env.PORT ?? 5173);

await startApiServer(API_PORT);

const root = fileURLToPath(new URL('../../src/client', import.meta.url));
const vite = await createServer({
  configFile: false,
  root,
  mode: 'standalone',
  plugins: [
    react(),
    tailwind(),
    {
      // `?user=bob` switches identity (cookie read by the API server).
      name: 'local-user',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const m = /[?&]user=([\w-]+)/.exec(req.url ?? '');
          if (m) res.setHeader('Set-Cookie', `oc_user=${m[1]}; Path=/`);
          if (req.url === '/' || req.url?.startsWith('/?')) req.url = '/game.html' + (req.url.slice(1) || '');
          next();
        });
      },
    },
  ],
  server: { port: WEB_PORT, host: true, proxy: { '/api/': `http://localhost:${API_PORT}` } },
});
await vite.listen();
console.log(`[local] open http://localhost:${WEB_PORT}/game.html  (feed view: /splash.html, switch user: ?user=bob)`);
