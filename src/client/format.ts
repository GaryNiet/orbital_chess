import type { Color, EndReason, GameView } from '../shared/api';

export const moveLabel = (ply: number, san: string) =>
  `${Math.ceil(ply / 2)}.${ply % 2 === 0 ? '..' : ''} ${san}`;

export const formatRate = (r: number | null) => (r === null ? '—' : `${Math.round(r)}%`);

const REASON: Record<EndReason, string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  'insufficient-material': 'insufficient material',
  'threefold-repetition': 'threefold repetition',
  'fifty-move-rule': 'the 50-move rule',
  'move-limit': 'the 200-ply limit',
};

/** "White won by checkmate — you won!" */
export const describeEnd = (g: GameView, viewer: Color | null) => {
  const reason = g.reason ? REASON[g.reason] : 'game over';
  if (g.result === '1/2-1/2') return `Draw by ${reason}`;
  const winner: Color = g.result === '1-0' ? 'w' : 'b';
  const base = `${winner === 'w' ? 'White' : 'Black'} won by ${reason}`;
  if (!viewer) return base;
  return `${base} — ${viewer === winner ? 'you won! 🎉' : 'you lost'}`;
};

export const timeAgo = (t: number) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export const toPgn = (g: GameView) => {
  const date = new Date(g.createdAt).toISOString().slice(0, 10).replace(/-/g, '.');
  const headers = [
    `[Event "Orbital Chess #${g.id.slice(1)}"]`,
    `[Site "reddit.com"]`,
    `[Date "${date}"]`,
    `[White "${g.moves.filter((m) => m.ply % 2 === 1).length} players"]`,
    `[Black "${g.moves.filter((m) => m.ply % 2 === 0).length} players"]`,
    `[Result "${g.result}"]`,
  ];
  const parts: string[] = [];
  for (const m of g.moves) {
    if (m.ply % 2 === 1) parts.push(`${Math.ceil(m.ply / 2)}.`);
    parts.push(m.san);
  }
  parts.push(g.result);
  return `${headers.join('\n')}\n\n${parts.join(' ')}\n`;
};
