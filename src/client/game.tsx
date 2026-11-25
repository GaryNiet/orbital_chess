import './index.css';

import { StrictMode, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Chess } from 'chess.js';
import type {
  ArchiveDay,
  Color,
  DayTreeResponse,
  HistoryDay,
  LeaderboardResponse,
  MeResponse,
  MoveResponse,
  Outcome,
  ServedPosition,
  Stats,
  TreeNode,
} from '../shared/api';
import { colorOfPly, isAncestorOrSelf, ROOT_ID, totalLines, winRateFor } from '../shared/api';
import { api } from './api';
import { Board, type BoardMove } from './components/Board';
import { isLocal } from './platform';
import { describeResult, formatDay, formatDuration, formatRate, moveLabel } from './format';

type Tab = 'play' | 'days' | 'leaders' | 'tools';

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------

const Btn = ({
  children,
  onClick,
  kind = 'primary',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  className?: string;
}) => {
  const styles = {
    primary: 'bg-[#ff4500] hover:bg-[#e03d00] text-white',
    secondary:
      'bg-zinc-200 hover:bg-zinc-300 text-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100',
    ghost: 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white',
  }[kind];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-10 px-4 rounded-full font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-black/5 dark:ring-white/10 p-4 ${className}`}>
    {children}
  </div>
);

const Muted = ({ children }: { children: ReactNode }) => (
  <Card className="text-center text-zinc-500 py-12">{children}</Card>
);

const ColorDot = ({ color }: { color: Color }) => (
  <span
    className={`inline-block w-3 h-3 shrink-0 rounded-full ring-1 ring-zinc-500 align-middle ${color === 'w' ? 'bg-white' : 'bg-zinc-900'}`}
  />
);

const StatsBar = ({ stats }: { stats: Stats }) => (
  <div className="grid grid-cols-4 gap-2 text-center">
    {[
      ['Win rate', formatRate(stats.winRate)],
      ['Scored moves', String(stats.moves)],
      ['Today', String(stats.pending)],
      ['Rank', stats.rank ? `#${stats.rank}` : '—'],
    ].map(([k, v]) => (
      <div key={k} className="rounded-lg bg-zinc-100 dark:bg-zinc-800/70 py-2">
        <div className="text-base font-bold text-zinc-900 dark:text-white tabular-nums">{v}</div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</div>
      </div>
    ))}
  </div>
);

/** White / draw / black share of the lines under a move. */
const OutcomeBar = ({ out }: { out: Outcome }) => {
  const t = totalLines(out) || 1;
  return (
    <div
      className="flex h-2 w-full rounded-full overflow-hidden ring-1 ring-black/10"
      title={`White ${out.w} · Draw ${out.d} · Black ${out.b}`}
    >
      <div className="bg-zinc-50" style={{ width: `${(out.w / t) * 100}%` }} />
      <div className="bg-zinc-400" style={{ width: `${(out.d / t) * 100}%` }} />
      <div className="bg-zinc-900" style={{ width: `${(out.b / t) * 100}%` }} />
    </div>
  );
};

const useToast = () => {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] bg-zinc-900 text-white text-sm px-4 py-2 rounded-full shadow-lg dark:bg-white dark:text-zinc-900">
      {msg}
    </div>
  ) : null;
  return [node, setMsg] as const;
};

/** Offset between the server's game clock and this device's clock. */
let clockSkew = 0;
const gameNow = () => Date.now() + clockSkew;

const useNow = (everyMs = 30_000) => {
  const [now, setNow] = useState(gameNow);
  useEffect(() => {
    const t = setInterval(() => setNow(gameNow()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
};

/** Opening moves (dimmed) followed by the community's moves. */
const LineView = ({
  opening,
  line,
  onSelect,
  current,
}: {
  opening: string[];
  line: { san: string; key: string }[];
  onSelect?: (index: number) => void;
  current?: number;
}) => {
  const all = [...opening.map((san) => ({ san, key: '', open: true })), ...line.map((m) => ({ ...m, open: false }))];
  return (
    <div className="flex flex-wrap gap-x-1 gap-y-0.5 font-mono text-sm leading-6">
      {all.map((m, i) => {
        const ply = i + 1;
        const lineIdx = i - opening.length;
        return (
          <span key={i} className="whitespace-nowrap">
            {ply % 2 === 1 && <span className="text-zinc-400">{Math.ceil(ply / 2)}.</span>}
            <button
              type="button"
              disabled={m.open || !onSelect}
              onClick={() => onSelect?.(lineIdx + 1)}
              className={[
                'px-1 rounded',
                m.open ? 'text-zinc-400' : 'text-zinc-900 dark:text-zinc-100',
                !m.open && onSelect ? 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800' : '',
                current !== undefined && lineIdx + 1 === current ? 'bg-[#ff4500]/20' : '',
              ].join(' ')}
            >
              {m.san}
            </button>
          </span>
        );
      })}
    </div>
  );
};

const fenAt = (openingSan: string[], nodeId: string) => {
  const c = new Chess();
  for (const san of openingSan) c.move(san);
  for (const uci of nodeId.split('.').slice(1))
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
  return c;
};

// ---------------------------------------------------------------------------
// Play tab
// ---------------------------------------------------------------------------

type PlayState =
  | { kind: 'loading' }
  | { kind: 'none'; message: string; closesAt: number | null }
  | { kind: 'board'; pos: ServedPosition; pending: BoardMove | null }
  | { kind: 'done'; pos: ServedPosition; res: Extract<MoveResponse, { type: 'ok' }>; uci: string };

const fetchPosition = async (skip: boolean): Promise<PlayState> => {
  try {
    const r = await api.next(skip);
    return r.type === 'position'
      ? { kind: 'board', pos: r.position, pending: null }
      : { kind: 'none', message: r.message, closesAt: r.closesAt };
  } catch (e) {
    return { kind: 'none', message: e instanceof Error ? e.message : 'Could not load a position.', closesAt: null };
  }
};

const DayHeader = ({ pos }: { pos: ServedPosition }) => {
  const now = useNow();
  return (
    <div className="text-xs text-zinc-500 flex justify-between gap-2">
      <span className="truncate">
        Today: <b className="text-zinc-700 dark:text-zinc-300">{pos.opening.name}</b>
      </span>
      <span className="whitespace-nowrap">reveal in {formatDuration(pos.closesAt - now)}</span>
    </div>
  );
};

const PlayTab = ({ onStats, toast }: { onStats: (s: Stats) => void; toast: (m: string) => void }) => {
  const [state, setState] = useState<PlayState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const load = useCallback(async (skip = false) => {
    setState({ kind: 'loading' });
    setState(await fetchPosition(skip));
  }, []);

  useEffect(() => {
    void fetchPosition(false).then(setState);
  }, []);

  const preview = useMemo(() => {
    if (state.kind !== 'board' || !state.pending) return null;
    const c = new Chess(state.pos.fen);
    try {
      const mv = c.move(state.pending);
      return { fen: c.fen(), san: mv.san, uci: `${mv.from}${mv.to}${mv.promotion ?? ''}` };
    } catch {
      return null;
    }
  }, [state]);

  if (state.kind === 'loading') return <Muted>Finding a position for you…</Muted>;

  if (state.kind === 'none')
    return (
      <Card className="text-center py-10 space-y-4">
        <p className="text-zinc-700 dark:text-zinc-300">{state.message}</p>
        {state.closesAt && (
          <p className="text-sm text-zinc-500">
            Today's tree is revealed in {formatDuration(state.closesAt - now)}.
          </p>
        )}
        <Btn onClick={() => void load()}>Try again</Btn>
      </Card>
    );

  if (state.kind === 'done') {
    const { pos, res, uci } = state;
    const after = new Chess(pos.fen);
    after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
    return (
      <div className="space-y-3">
        <Card className="space-y-1">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
            You played <span className="font-mono">{moveLabel(res.ply, res.san)}</span>
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {res.newBranch
              ? 'Nobody had played that here yet: you started a new branch.'
              : 'Someone else had already played that here, so your move joined their branch.'}{' '}
            {res.ended
              ? `${describeResult(res.ended.result, res.ended.reason)}. That line is finished.`
              : 'Other players will continue from here.'}
          </p>
          <p className="text-sm text-zinc-500">
            Your win rate for this move is revealed with the whole tree in {formatDuration(pos.closesAt - now)}.
          </p>
        </Card>
        <Board
          fen={after.fen()}
          orientation={pos.color}
          lastMove={{ from: uci.slice(0, 2), to: uci.slice(2, 4) }}
        />
        <Btn className="w-full" onClick={() => void load()}>
          Next position →
        </Btn>
      </div>
    );
  }

  const { pos, pending } = state;
  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api.move(pos.day, pos.nodeId, preview.uci);
      if (r.type === 'error') {
        toast(r.message);
        await load();
      } else {
        onStats(r.stats);
        setState({ kind: 'done', pos, res: r, uci: preview.uci });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Move failed');
    } finally {
      setBusy(false);
    }
  };
  const last = pos.line[pos.line.length - 1];

  return (
    <div className="space-y-3">
      <Card className="space-y-2 py-3">
        <DayHeader pos={pos} />
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <ColorDot color={pos.color} /> {pos.color === 'w' ? 'White' : 'Black'} to play · move {Math.ceil(pos.ply / 2)}
          </div>
          <div className="text-xs text-zinc-500 text-right whitespace-nowrap">
            {pos.playedHere === 0 ? 'Fresh position' : `${pos.playedHere} played here`}
          </div>
        </div>
      </Card>

      <Board
        fen={preview?.fen ?? pos.fen}
        orientation={pos.color}
        interactiveFor={pending ? null : pos.color}
        onPick={(m) => setState({ ...state, pending: m })}
        lastMove={
          pending
            ? { from: pending.from, to: pending.to }
            : last
              ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) }
              : null
        }
      />

      {pending && preview ? (
        <div className="flex gap-2">
          <Btn kind="secondary" className="flex-1" onClick={() => setState({ ...state, pending: null })} disabled={busy}>
            Undo
          </Btn>
          <Btn className="flex-[2]" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Sending…' : `Confirm ${moveLabel(pos.ply, preview.san)}`}
          </Btn>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">One move here, then this path is closed to you for today.</p>
          <Btn kind="ghost" onClick={() => void load(true)}>
            Skip
          </Btn>
        </div>
      )}

      <Card className="space-y-1">
        <div className="text-xs text-zinc-500">{pos.opening.name}, then the community:</div>
        <LineView
          opening={pos.opening.san}
          line={pos.line.map((m) => ({ san: m.san, key: m.uci }))}
        />
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tree explorer (finished days)
// ---------------------------------------------------------------------------

const Explorer = ({ tree, mine, me }: { tree: DayTreeResponse; mine: HistoryDay; me: string }) => {
  const byId = useMemo(() => new Map(tree.nodes.map((n) => [n.id, n])), [tree]);
  const children = useMemo(() => {
    const m = new Map<string, TreeNode[]>();
    for (const n of tree.nodes)
      if (n.parent) m.set(n.parent, [...(m.get(n.parent) ?? []), n]);
    for (const list of m.values()) list.sort((a, b) => totalLines(b.out) - totalLines(a.out));
    return m;
  }, [tree]);
  // Positions where the viewer moved, and the nodes their moves led to.
  const myChildIds = useMemo(() => new Set(mine.moves.map((m) => `${m.nodeId}.${m.uci}`)), [mine]);
  const [at, setAt] = useState<string>(mine.moves[0]?.nodeId ?? ROOT_ID);

  const node = byId.get(at) ?? byId.get(ROOT_ID)!;
  const kids = children.get(node.id) ?? [];
  const pathIds = node.id.split('.').map((_, i, segs) => segs.slice(0, i + 1).join('.')).slice(1);
  const path = pathIds.map((id) => byId.get(id)!).filter(Boolean);
  const orientation: Color = mine.moves[0]?.color ?? 'w';
  const mover = colorOfPly(node.ply + 1);

  return (
    <div className="space-y-3">
      {mine.moves.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {mine.moves.map((m) => (
            <button
              key={m.nodeId}
              type="button"
              onClick={() => setAt(m.nodeId)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm cursor-pointer ring-1 ${
                at === m.nodeId
                  ? 'bg-[#ff4500] text-white ring-[#ff4500]'
                  : 'bg-white dark:bg-zinc-900 ring-black/10 dark:ring-white/15'
              }`}
            >
              <span className="font-mono font-bold">{moveLabel(m.ply, m.san)}</span>
              <span className="ml-1.5 opacity-80">{formatRate(m.winRate)}</span>
            </button>
          ))}
        </div>
      )}

      <Board
        fen={node.fen}
        orientation={orientation}
        lastMove={node.uci ? { from: node.uci.slice(0, 2), to: node.uci.slice(2, 4) } : null}
      />

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <Btn kind="ghost" className="!px-0 !h-auto" disabled={!node.parent} onClick={() => node.parent && setAt(node.parent)}>
            ← Back
          </Btn>
          <Btn kind="ghost" className="!px-0 !h-auto" disabled={node.id === ROOT_ID} onClick={() => setAt(ROOT_ID)}>
            Start
          </Btn>
        </div>
        <LineView
          opening={tree.opening.san}
          line={path.map((n) => ({ san: n.san, key: n.id }))}
          current={path.length}
          onSelect={(i) => setAt(pathIds[i - 1] ?? ROOT_ID)}
        />
        {node.players.length > 0 && (
          <p className="text-xs text-zinc-500">
            {moveLabel(node.ply, node.san)} played by {node.players.map((p) => `u/${p}`).join(', ')}
          </p>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex justify-between text-xs text-zinc-500">
          <span>
            {kids.length
              ? `${kids.length} move${kids.length === 1 ? '' : 's'} played here (${mover === 'w' ? 'White' : 'Black'} to move)`
              : 'End of the line'}
          </span>
          {kids.length > 0 && <span>win % for the mover</span>}
        </div>
        {kids.length === 0 && node.end && (
          <p className="px-4 pb-4 font-semibold text-zinc-900 dark:text-white">
            {describeResult(node.end.result, node.end.reason)}
          </p>
        )}
        {kids.map((k) => {
          const rate = winRateFor(k.out, colorOfPly(k.ply));
          const isMine = myChildIds.has(k.id);
          const leadsToMine = !isMine && mine.moves.some((m) => isAncestorOrSelf(k.id, m.nodeId));
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => setAt(k.id)}
              className={`w-full text-left border-t border-zinc-100 dark:border-zinc-800 px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${
                isMine ? 'bg-[#ff4500]/10' : ''
              }`}
            >
              <div className="w-20 shrink-0">
                <div className="font-mono font-bold text-zinc-900 dark:text-white">{k.san}</div>
                <div className="text-[11px] text-zinc-500">
                  {k.players.length} player{k.players.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <OutcomeBar out={k.out} />
                <div className="text-[11px] text-zinc-500 truncate">
                  {totalLines(k.out)} line{totalLines(k.out) === 1 ? '' : 's'}
                  {k.end ? ` · ${describeResult(k.end.result, k.end.reason)}` : ''}
                  {isMine ? ' · your move' : leadsToMine ? ' · leads to your move' : ''}
                  {k.players.includes(me) && !isMine ? ' · you' : ''}
                </div>
              </div>
              <div className="w-12 text-right font-bold tabular-nums text-zinc-900 dark:text-white">
                {formatRate(rate)}
              </div>
            </button>
          );
        })}
      </Card>
    </div>
  );
};

/** A day that is still running: only your own moves are visible. */
const OpenDay = ({ mine, closesAt }: { mine: HistoryDay; closesAt: number }) => {
  const now = useNow();
  const [sel, setSel] = useState(0);
  const m = mine.moves[sel];
  const pos = useMemo(() => (m ? fenAt(mine.opening.san, m.nodeId).fen() : null), [m, mine]);
  return (
    <div className="space-y-3">
      <Card className="text-sm text-zinc-600 dark:text-zinc-400">
        The tree stays hidden until the day is over, in {formatDuration(closesAt - now)}. Until then you only see your
        own moves.
      </Card>
      {!m && <Muted>You haven't played today yet.</Muted>}
      {m && pos && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {mine.moves.map((x, i) => (
              <button
                key={x.nodeId}
                type="button"
                onClick={() => setSel(i)}
                className={`shrink-0 rounded-full px-3 py-1 text-sm font-mono font-bold cursor-pointer ring-1 ${
                  i === sel ? 'bg-[#ff4500] text-white ring-[#ff4500]' : 'bg-white dark:bg-zinc-900 ring-black/10 dark:ring-white/15'
                }`}
              >
                {moveLabel(x.ply, x.san)}
              </button>
            ))}
          </div>
          <Board fen={pos} orientation={m.color} marked={{ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) }} />
          <p className="text-center text-sm text-zinc-500">
            You played <b className="font-mono text-[#ff4500]">{m.san}</b> from this position
          </p>
        </>
      )}
    </div>
  );
};

const DayView = ({ day, me, onBack }: { day: ArchiveDay; me: string; onBack: () => void }) => {
  const [mine, setMine] = useState<HistoryDay | null>(null);
  const [tree, setTree] = useState<DayTreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load');
    api.myDay(day.day).then(setMine, fail);
    if (day.closed) api.tree(day.day).then(setTree, fail);
  }, [day]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Btn kind="ghost" className="!px-0" onClick={onBack}>
          ← All days
        </Btn>
        <span className="text-sm text-zinc-500">{formatDay(day.day)}</span>
      </div>
      <Card className="space-y-1">
        <div className="font-bold text-zinc-900 dark:text-white">{day.opening.name}</div>
        <div className="text-sm text-zinc-500">
          {day.players} players · {day.moves} moves
          {mine && mine.dayRate !== null ? ` · your day: ${formatRate(mine.dayRate)}` : ''}
        </div>
      </Card>
      {error && <Card className="text-rose-600">{error}</Card>}
      {!error && !mine && <Muted>Loading…</Muted>}
      {mine && !day.closed && <OpenDay mine={mine} closesAt={Date.parse(`${day.day}T00:00:00Z`) + 86_400_000} />}
      {mine && day.closed && (tree ? <Explorer tree={tree} mine={mine} me={me} /> : !error && <Muted>Loading tree…</Muted>)}
    </div>
  );
};

const DaysTab = ({ me }: { me: string }) => {
  const [days, setDays] = useState<ArchiveDay[] | null>(null);
  const [open, setOpen] = useState<ArchiveDay | null>(null);
  useEffect(() => {
    api.days().then((r) => setDays(r.days), () => setDays([]));
  }, []);

  if (open) return <DayView day={open} me={me} onBack={() => setOpen(null)} />;
  if (!days) return <Muted>Loading days…</Muted>;
  if (!days.length) return <Muted>No games yet. Be the first to play today!</Muted>;
  return (
    <div className="space-y-2">
      {days.map((d) => (
        <button
          key={d.day}
          type="button"
          onClick={() => setOpen(d)}
          className="w-full text-left rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-black/5 dark:ring-white/10 p-3 flex items-center gap-3 cursor-pointer hover:ring-[#ff4500]/50"
        >
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-zinc-900 dark:text-white truncate">{d.opening.name}</div>
            <div className="text-xs text-zinc-500">
              {formatDay(d.day)} · {d.players} players · {d.moves} moves
              {d.myMoves ? ` · you: ${d.myMoves}` : ''}
            </div>
          </div>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              d.closed
                ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
            }`}
          >
            {d.closed ? 'View tree' : 'Today'}
          </span>
        </button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Leaderboard + tools
// ---------------------------------------------------------------------------

const LeadersTab = ({ me }: { me: string }) => {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  useEffect(() => {
    void api.leaderboard().then(setData);
  }, []);
  if (!data) return <Muted>Loading…</Muted>;
  return (
    <Card className="p-0 overflow-hidden">
      <p className="text-xs text-zinc-500 px-4 pt-3 pb-2">
        Average branch win rate · at least {data.minMoves} scored moves
      </p>
      {data.entries.length === 0 && <p className="px-4 pb-4 text-sm text-zinc-500">Nobody qualifies yet.</p>}
      <table className="w-full text-sm">
        <tbody>
          {data.entries.map((e) => (
            <tr
              key={e.username}
              className={`border-t border-zinc-100 dark:border-zinc-800 ${e.username === me ? 'bg-[#ff4500]/10' : ''}`}
            >
              <td className="pl-4 pr-2 py-2 w-12 text-zinc-400 tabular-nums">{e.rank}</td>
              <td className="py-2 font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-0 w-full">u/{e.username}</td>
              <td className="py-2 px-2 text-xs text-zinc-500 tabular-nums whitespace-nowrap">{e.moves} moves</td>
              <td className="pr-4 py-2 text-right font-bold tabular-nums text-zinc-900 dark:text-white">
                {formatRate(e.winRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};

const ToolsTab = ({ toast, onChange }: { toast: (m: string) => void; onChange: () => void }) => {
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    toast(`${label}…`);
    try {
      toast(await fn());
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3">
      <h2 className="font-bold text-zinc-900 dark:text-white">Test data (moderators)</h2>
      <ul className="text-sm text-zinc-600 dark:text-zinc-400 list-disc pl-5 space-y-1">
        <li>
          <b>Seed</b> plays 4 past days and part of today with fake players. Some moves are made in your name, so you
          have a history, a win rate and a rank.
        </li>
        <li>
          <b>Simulate</b> makes fake players move on today's tree.
        </li>
        <li>
          <b>Advance day</b> moves this subreddit's game clock one day forward. Today closes and its tree is revealed.
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Btn
          disabled={busy}
          onClick={() =>
            void run('Seeding', async () => {
              const r = await api.seed();
              return `Seeded ${r.days} days with ${r.moves} moves`;
            })
          }
        >
          Seed demo data
        </Btn>
        <Btn
          kind="secondary"
          disabled={busy}
          onClick={() =>
            void run('Fake players are moving', async () => {
              const r = await api.simulate(40);
              return `Fake players made ${r.played} moves`;
            })
          }
        >
          Simulate 40 moves
        </Btn>
        <Btn
          kind="secondary"
          disabled={busy}
          onClick={() =>
            void run('Advancing', async () => {
              const r = await api.advanceDay();
              return `Now ${r.today}. Revealed: ${r.closed.join(', ') || 'nothing'}`;
            })
          }
        >
          Advance day
        </Btn>
        <Btn
          kind="ghost"
          disabled={busy}
          onClick={() =>
            void run('Resetting', async () => {
              const r = await api.reset();
              return `Deleted ${r.days} days`;
            })
          }
        >
          Reset everything
        </Btn>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export const App = () => {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('play');
  const [epoch, setEpoch] = useState(0); // bump to remount tabs after test-data changes
  const [toastNode, toast] = useToast();

  const refreshMe = useCallback(() => {
    api.me().then((m) => {
      clockSkew = m.now - Date.now();
      setMe(m);
    }, (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);
  useEffect(refreshMe, [refreshMe]);

  if (error)
    return <div className="min-h-screen flex items-center justify-center p-6 text-center text-zinc-600">{error}</div>;
  if (!me) return <div className="min-h-screen flex items-center justify-center text-zinc-500">Loading…</div>;

  const tabs: [Tab, string][] = [
    ['play', 'Play'],
    ['days', 'Days'],
    ['leaders', 'Leaderboard'],
  ];
  if (me.isModerator) tabs.push(['tools', 'Test data']);

  return (
    <div className="min-h-screen text-zinc-900 dark:text-zinc-100">
      <div className="max-w-md mx-auto px-3 py-3 space-y-3">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-black tracking-tight">
            Orbital <span className="text-[#ff4500]">Chess</span>
          </h1>
          <span className="text-xs text-zinc-500">
            u/{me.username}
            {isLocal ? ` · local · ${me.today}` : ''}
          </span>
        </header>
        <StatsBar stats={me.stats} />
        <nav className="flex gap-1 bg-zinc-200/70 dark:bg-zinc-800/70 p-1 rounded-full">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 text-sm font-semibold py-1.5 rounded-full cursor-pointer transition-colors ${tab === t ? 'bg-white dark:bg-zinc-950 shadow text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <main key={`${tab}-${epoch}`}>
          {tab === 'play' && <PlayTab onStats={(stats) => setMe({ ...me, stats })} toast={toast} />}
          {tab === 'days' && <DaysTab me={me.username} />}
          {tab === 'leaders' && <LeadersTab me={me.username} />}
          {tab === 'tools' && (
            <ToolsTab
              toast={toast}
              onChange={() => {
                refreshMe();
                setEpoch((n) => n + 1);
              }}
            />
          )}
        </main>
      </div>
      {toastNode}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
