import type { EndReason, LineResult } from '../shared/api';

export const moveLabel = (ply: number, san: string) =>
  `${Math.ceil(ply / 2)}.${ply % 2 === 0 ? '..' : ''} ${san}`;

export const formatRate = (r: number | null) => (r === null ? '—' : `${Math.round(r)}%`);

export const REASON: Record<EndReason, string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  'insufficient-material': 'insufficient material',
  'threefold-repetition': 'threefold repetition',
  'fifty-move-rule': 'the 50-move rule',
  adjudicated: 'material at midnight',
};

export const describeResult = (result: LineResult, reason: EndReason) => {
  if (result === '1/2-1/2') return `Draw by ${REASON[reason]}`;
  return `${result === '1-0' ? 'White' : 'Black'} wins by ${REASON[reason]}`;
};

export const formatDuration = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};

export const formatDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
