import { useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Color } from '../../shared/api';

// U+FE0E asks for the text (not emoji) presentation, which matters on iOS.
const GLYPH: Record<string, string> = {
  k: '♚︎',
  q: '♛︎',
  r: '♜︎',
  b: '♝︎',
  n: '♞︎',
  p: '♟︎',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export type BoardMove = { from: string; to: string; promotion?: string };

type Props = {
  fen: string;
  orientation: Color;
  /** When set, the player may pick a move for this colour. */
  interactiveFor?: Color | null;
  onPick?: (move: BoardMove) => void;
  lastMove?: { from: string; to: string } | null;
  /** Extra ring around these squares (e.g. "your move" in history). */
  marked?: { from: string; to: string } | null;
};

export const Piece = ({ type, color, className = '' }: { type: string; color: Color; className?: string }) => (
  <span
    className={`piece select-none leading-none ${color === 'w' ? 'piece-white' : 'piece-black'} ${className}`}
    aria-hidden
  >
    {GLYPH[type]}
  </span>
);

export const Board = ({ fen, orientation, interactiveFor, onPick, lastMove, marked }: Props) => {
  const chess = useMemo(() => new Chess(fen), [fen]);
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [prevFen, setPrevFen] = useState(fen);
  if (fen !== prevFen) {
    setPrevFen(fen);
    setSelected(null);
    setPromo(null);
  }

  const canMove = !!interactiveFor && chess.turn() === interactiveFor;
  const targets = useMemo(() => {
    if (!selected || !canMove) return new Map<string, { capture: boolean; promotion: boolean }>();
    const m = new Map<string, { capture: boolean; promotion: boolean }>();
    for (const mv of chess.moves({ square: selected as Square, verbose: true })) {
      m.set(mv.to, { capture: !!mv.captured, promotion: !!mv.promotion });
    }
    return m;
  }, [chess, selected, canMove]);

  const checkedKing = useMemo(() => {
    if (!chess.isCheck()) return null;
    for (const row of chess.board())
      for (const sq of row) if (sq && sq.type === 'k' && sq.color === chess.turn()) return sq.square;
    return null;
  }, [chess]);

  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === 'w' ? FILES : [...FILES].reverse();

  const click = (sq: string) => {
    if (!canMove) return;
    const piece = chess.get(sq as Square);
    if (selected && targets.has(sq)) {
      if (targets.get(sq)!.promotion) {
        setPromo({ from: selected, to: sq });
        return;
      }
      onPick?.({ from: selected, to: sq });
      setSelected(null);
      return;
    }
    if (piece && piece.color === interactiveFor) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  };

  return (
    <div className="relative w-full aspect-square select-none rounded-md overflow-hidden shadow-lg ring-1 ring-black/10">
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {ranks.map((rank, ri) =>
          files.map((file, fi) => {
            const sq = `${file}${rank}`;
            const piece = chess.get(sq as Square);
            const dark = (FILES.indexOf(file) + rank) % 2 === 1; // a1 is dark
            const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
            const isMarked = marked && (marked.from === sq || marked.to === sq);
            const target = targets.get(sq);
            const own = canMove && piece?.color === interactiveFor;
            return (
              <button
                key={sq}
                type="button"
                onClick={() => click(sq)}
                aria-label={sq}
                className={[
                  'relative flex items-center justify-center p-0 border-0',
                  dark ? 'sq-dark' : 'sq-light',
                  canMove && (own || target) ? 'cursor-pointer' : 'cursor-default',
                ].join(' ')}
              >
                {isLast && <span className="absolute inset-0 sq-last" />}
                {selected === sq && <span className="absolute inset-0 sq-selected" />}
                {checkedKing === sq && <span className="absolute inset-0 sq-check" />}
                {isMarked && <span className="absolute inset-[3%] rounded-sm sq-mine" />}
                {piece && <Piece type={piece.type} color={piece.color} className="relative text-[min(10vw,52px)]" />}
                {target &&
                  (target.capture ? (
                    <span className="absolute inset-[6%] rounded-full border-[5px] border-black/25" />
                  ) : (
                    <span className="absolute w-[30%] h-[30%] rounded-full bg-black/25" />
                  ))}
                {fi === 0 && (
                  <span className={`absolute top-0.5 left-1 text-[10px] font-semibold ${dark ? 'coord-on-dark' : 'coord-on-light'}`}>
                    {rank}
                  </span>
                )}
                {ri === 7 && (
                  <span className={`absolute bottom-0 right-1 text-[10px] font-semibold ${dark ? 'coord-on-dark' : 'coord-on-light'}`}>
                    {file}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      {promo && interactiveFor && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center" onClick={() => setPromo(null)}>
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 flex gap-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {['q', 'r', 'b', 'n'].map((p) => (
              <button
                key={p}
                type="button"
                className="w-14 h-14 rounded-md sq-light flex items-center justify-center cursor-pointer hover:brightness-95"
                onClick={() => {
                  onPick?.({ ...promo, promotion: p });
                  setPromo(null);
                  setSelected(null);
                }}
              >
                <Piece type={p} color={interactiveFor} className="text-5xl" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
