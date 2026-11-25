import { requestExpandedMode } from '@devvit/web/client';

/** True when running through `npm run dev:local` instead of inside Reddit. */
export const isLocal = import.meta.env.MODE === 'standalone';

export const expandToGame = (e: MouseEvent) => {
  if (isLocal) window.open('/game.html', '_self');
  else requestExpandedMode(e, 'game');
};
