import './index.css';

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { context } from '@devvit/web/client';
import type { MeResponse } from '../shared/api';
import { expandToGame } from './platform';

// A static decorative position (after 1.e4 e5 2.Nf3 Nc6 3.Bb5) — no chess.js here
// so the feed view stays tiny.
const ROWS = ['r.bqkbnr', 'pppp.ppp', '..n.....', '.B..p...', '....P...', '.....N..', 'PPPP.PPP', 'RNBQK..R'];
const G: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

const MiniBoard = () => (
  <div className="grid grid-cols-8 grid-rows-8 w-36 h-36 rounded overflow-hidden shadow-md ring-1 ring-black/10 shrink-0">
    {ROWS.flatMap((row, r) =>
      [...row].map((ch, f) => (
        <div key={`${r}${f}`} className={`flex items-center justify-center ${(r + f) % 2 ? 'sq-dark' : 'sq-light'}`}>
          {ch !== '.' && (
            <span className={`piece text-[17px] leading-none ${ch === ch.toUpperCase() ? 'piece-white' : 'piece-black'}`}>
              {G[ch.toLowerCase()]}
              {'︎'}
            </span>
          )}
        </div>
      ))
    )}
  </div>
);

export const Splash = () => {
  const [me, setMe] = useState<MeResponse | null>(null);
  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
      .then(setMe, () => setMe(null));
  }, []);
  const s = me?.stats;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 text-zinc-900 dark:text-zinc-100">
      <div className="flex items-center gap-5 max-w-md">
        <MiniBoard />
        <div className="space-y-2">
          <h1 className="text-2xl font-black tracking-tight leading-none">
            Orbital <span className="text-[#ff4500]">Chess</span>
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-snug">
            One move per game, then the board orbits to the next player. Play as many boards as you like — chase the
            best win rate.
          </p>
          {s && (
            <p className="text-xs text-zinc-500">
              {me?.username ?? context?.username}: {s.winRate === null ? 'no finished games yet' : `${Math.round(s.winRate)}% wins`}
              {s.pending ? ` · ${s.pending} games in play` : ''}
            </p>
          )}
          <button
            type="button"
            className="h-10 px-5 rounded-full bg-[#ff4500] hover:bg-[#e03d00] text-white font-semibold text-sm cursor-pointer"
            onClick={(e) => expandToGame(e.nativeEvent)}
          >
            Play a move
          </button>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
