import './index.css';

import { StrictMode, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Chess } from 'chess.js';
import type {
  Color,
  GameView,
  HistoryEntry,
  LeaderboardResponse,
  MeResponse,
  MoveRecord,
  NextGameResponse,
  Stats,
} from '../shared/api';
import { api } from './api';
import { Board, type BoardMove } from './components/Board';
import { isLocal, openExternal } from './platform';
import { describeEnd, formatRate, moveLabel, timeAgo, toPgn } from './format';

type Tab = 'play' | 'history' | 'leaders' | 'tools';

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

const ColorDot = ({ color }: { color: Color }) => (
  <span
    className={`inline-block w-3 h-3 rounded-full ring-1 ring-zinc-500 align-middle ${color === 'w' ? 'bg-white' : 'bg-zinc-900'}`}
  />
);

const OutcomeBadge = ({ outcome }: { outcome: HistoryEntry['outcome'] }) => {
  const map = {
    win: ['Win', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'],
    loss: ['Loss', 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300'],
    draw: ['Draw', 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'],
    pending: ['In play', 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'],
  } as const;
  const [label, cls] = map[outcome ?? 'pending'];
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
};

const StatsBar = ({ stats }: { stats: Stats }) => (
  <div className="grid grid-cols-4 gap-2 text-center">
    {[
      ['Win rate', formatRate(stats.winRate)],
      ['W / D / L', `${stats.wins} / ${stats.draws} / ${stats.losses}`],
      ['Waiting', String(stats.pending)],
      ['Rank', stats.rank ? `#${stats.rank}` : '—'],
    ].map(([k, v]) => (
      <div key={k} className="rounded-lg bg-zinc-100 dark:bg-zinc-800/70 py-2">
        <div className="text-base font-bold text-zinc-900 dark:text-white tabular-nums">{v}</div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</div>
      </div>
    ))}
  </div>
);

const useToast = () => {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white text-sm px-4 py-2 rounded-full shadow-lg dark:bg-white dark:text-zinc-900">
      {msg}
    </div>
  ) : null;
  return [node, setMsg] as const;
};

const lastMoveOf = (moves: MoveRecord[]) => {
  const m = moves[moves.length - 1];
  return m ? { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) } : null;
};

const MoveList = ({
  moves,
  current,
  mine,
  onSelect,
}: {
  moves: MoveRecord[];
  current?: number;
  mine?: number | null;
  onSelect?: (ply: number) => void;
}) => {
  const rows: { n: number; w?: MoveRecord; b?: MoveRecord }[] = [];
  for (const m of moves) {
    const n = Math.ceil(m.ply / 2);
    if (m.ply % 2 === 1) rows.push({ n, w: m });
    else if (rows.length && rows[rows.length - 1]!.n === n) rows[rows.length - 1]!.b = m;
    else rows.push({ n, b: m });
  }
  const cell = (m?: MoveRecord) =>
    m ? (
      <button
        type="button"
        onClick={() => onSelect?.(m.ply)}
        title={`u/${m.user}`}
        className={[
          'text-left px-1.5 py-0.5 rounded font-mono text-sm cursor-pointer',
          m.ply === current ? 'bg-[#ff4500]/20' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
          m.ply === mine ? 'font-bold text-[#ff4500]' : 'text-zinc-800 dark:text-zinc-200',
        ].join(' ')}
      >
        {m.san}
      </button>
    ) : (
      <span className="px-1.5 text-zinc-400">…</span>
    );
  if (!moves.length) return <p className="text-sm text-zinc-500">No moves yet — you open the game.</p>;
  return (
    <div className="max-h-40 overflow-y-auto grid grid-cols-[2.2rem_1fr_1fr] gap-y-0.5 text-sm">
      {rows.map((r) => (
        <div key={r.n} className="contents">
          <span className="text-zinc-400 font-mono py-0.5">{r.n}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Play tab
// ---------------------------------------------------------------------------

type PlayState =
  | { kind: 'loading' }
  | { kind: 'none'; message: string }
  | { kind: 'board'; res: Extract<NextGameResponse, { type: 'game' }>; pending: BoardMove | null }
  | { kind: 'done'; game: GameView; color: Color };

const Countdown = ({ until }: { until: number }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((until - now) / 1000));
  return (
    <span className={s < 30 ? 'text-rose-500' : ''}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
};

const fetchBoard = async (skip: boolean): Promise<PlayState> => {
  try {
    const res = await api.next(skip);
    return res.type === 'game' ? { kind: 'board', res, pending: null } : { kind: 'none', message: res.message };
  } catch (e) {
    return { kind: 'none', message: e instanceof Error ? e.message : 'Could not load a board.' };
  }
};

const PlayTab = ({ onStats, toast }: { onStats: (s: Stats) => void; toast: (m: string) => void }) => {
  const [state, setState] = useState<PlayState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (skip = false) => {
    setState({ kind: 'loading' });
    setState(await fetchBoard(skip));
  }, []);

  useEffect(() => {
    void fetchBoard(false).then(setState);
  }, []);

  // The position shown on the board, with the not-yet-confirmed move applied.
  const preview = useMemo(() => {
    if (state.kind !== 'board' || !state.pending) return null;
    const c = new Chess(state.res.game.fen);
    try {
      const mv = c.move(state.pending);
      return { fen: c.fen(), san: mv.san, uci: `${mv.from}${mv.to}${mv.promotion ?? ''}` };
    } catch {
      return null;
    }
  }, [state]);

  if (state.kind === 'loading')
    return <Card className="text-center text-zinc-500 py-16">Finding a board that needs you…</Card>;

  if (state.kind === 'none')
    return (
      <Card className="text-center py-12 space-y-4">
        <p className="text-zinc-700 dark:text-zinc-300">{state.message}</p>
        <Btn onClick={() => void load()}>Try again</Btn>
      </Card>
    );

  if (state.kind === 'done') {
    const { game, color } = state;
    const mine = game.myMove;
    return (
      <div className="space-y-3">
        <Card className="space-y-1">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
            {game.status === 'finished' ? describeEnd(game, color) : 'Move played — board passed on!'}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You played <b className="font-mono">{mine ? moveLabel(mine.ply, mine.san) : ''}</b> as{' '}
            {color === 'w' ? 'White' : 'Black'} in game #{game.id.slice(1)}.{' '}
            {game.status === 'active' && 'Your win rate updates when this game ends — check "My moves".'}
          </p>
        </Card>
        <Board fen={game.fen} orientation={color} lastMove={lastMoveOf(game.moves)} />
        <Btn className="w-full" onClick={() => void load()}>
          Play the next board →
        </Btn>
      </div>
    );
  }

  const { res, pending } = state;
  const { game, color } = res;
  const ply = game.moves.length;
  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api.move(game.id, ply, preview.uci);
      if (r.type === 'error') {
        toast(r.message);
        await load();
      } else {
        onStats(r.stats);
        setState({ kind: 'done', game: r.game, color });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Move failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="flex items-center justify-between gap-2 py-3">
        <div>
          <div className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <ColorDot color={color} /> You play {color === 'w' ? 'White' : 'Black'}
          </div>
          <div className="text-xs text-zinc-500">
            Game #{game.id.slice(1)} · move {Math.floor(ply / 2) + 1} · {ply} player{ply === 1 ? '' : 's'} so far
          </div>
        </div>
        <div className="text-right text-xs text-zinc-500">
          Reserved for you
          <div className="font-mono text-sm text-zinc-800 dark:text-zinc-200">
            <Countdown until={res.lockExpiresAt} />
          </div>
        </div>
      </Card>

      <Board
        fen={preview?.fen ?? game.fen}
        orientation={color}
        interactiveFor={pending ? null : color}
        onPick={(m) => setState({ ...state, pending: m })}
        lastMove={pending ? { from: pending.from, to: pending.to } : lastMoveOf(game.moves)}
      />

      {pending && preview ? (
        <div className="flex gap-2">
          <Btn kind="secondary" className="flex-1" onClick={() => setState({ ...state, pending: null })} disabled={busy}>
            Undo
          </Btn>
          <Btn className="flex-[2]" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Sending…' : `Confirm ${moveLabel(ply + 1, preview.san)}`}
          </Btn>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">Tap a piece, then a square. You only get this one move.</p>
          <Btn kind="ghost" onClick={() => void load(true)}>
            Skip
          </Btn>
        </div>
      )}

      <Card>
        <MoveList moves={game.moves} />
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// History tab + game viewer
// ---------------------------------------------------------------------------

const GameViewer = ({ id, onBack, toast }: { id: string; onBack: () => void; toast: (m: string) => void }) => {
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);

  useEffect(() => {
    api.game(id).then(
      (g) => {
        setGame(g);
        setPly(g.myMove?.ply ?? g.moves.length);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load game')
    );
  }, [id]);

  const fens = useMemo(() => {
    if (!game) return [];
    const c = new Chess();
    const out = [c.fen()];
    for (const m of game.moves) {
      c.move(m.san);
      out.push(c.fen());
    }
    return out;
  }, [game]);

  if (error) return <Card className="text-rose-600">{error}</Card>;
  if (!game) return <Card className="text-center text-zinc-500 py-16">Loading game…</Card>;

  const color = game.myMove?.color ?? 'w';
  const cur = game.moves[ply - 1];
  const mine = game.myMove;
  const max = game.moves.length;
  const pgn = toPgn(game);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Btn kind="ghost" onClick={onBack}>
          ← My moves
        </Btn>
        <span className="text-sm text-zinc-500">Game #{game.id.slice(1)}</span>
      </div>
      <Card className="space-y-1">
        <div className="font-bold text-zinc-900 dark:text-white">
          {game.status === 'finished' ? describeEnd(game, mine?.color ?? null) : `In play · ${max} moves so far`}
        </div>
        {mine && (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Your move: <b className="font-mono text-[#ff4500]">{moveLabel(mine.ply, mine.san)}</b> as{' '}
            {mine.color === 'w' ? 'White' : 'Black'} · {timeAgo(mine.at)}
          </div>
        )}
      </Card>

      <Board
        fen={fens[ply] ?? game.fen}
        orientation={color}
        lastMove={cur ? { from: cur.uci.slice(0, 2), to: cur.uci.slice(2, 4) } : null}
        marked={mine && ply === mine.ply ? { from: mine.uci.slice(0, 2), to: mine.uci.slice(2, 4) } : null}
      />

      <div className="flex items-center gap-1 justify-center">
        <Btn kind="secondary" onClick={() => setPly(0)} disabled={ply === 0}>
          ⏮
        </Btn>
        <Btn kind="secondary" onClick={() => setPly(Math.max(0, ply - 1))} disabled={ply === 0}>
          ◀
        </Btn>
        {mine && (
          <Btn kind="primary" onClick={() => setPly(mine.ply)}>
            My move
          </Btn>
        )}
        <Btn kind="secondary" onClick={() => setPly(Math.min(max, ply + 1))} disabled={ply === max}>
          ▶
        </Btn>
        <Btn kind="secondary" onClick={() => setPly(max)} disabled={ply === max}>
          ⏭
        </Btn>
      </div>
      <p className="text-center text-xs text-zinc-500 h-4">
        {cur ? `${moveLabel(cur.ply, cur.san)} by u/${cur.user}` : 'Starting position'}
      </p>

      <Card>
        <MoveList moves={game.moves} current={ply} mine={mine?.ply ?? null} onSelect={setPly} />
      </Card>

      <div className="flex gap-2">
        <Btn
          kind="secondary"
          className="flex-1"
          onClick={() => openExternal(`https://lichess.org/analysis/standard/${(fens[ply] ?? game.fen).replace(/ /g, '_')}`)}
        >
          Analyze on Lichess
        </Btn>
        <Btn
          kind="secondary"
          className="flex-1"
          onClick={() => {
            navigator.clipboard.writeText(pgn).then(
              () => toast('PGN copied — paste it at lichess.org/paste'),
              () => toast('Could not copy PGN')
            );
          }}
        >
          Copy PGN
        </Btn>
      </div>
    </div>
  );
};

const HistoryTab = ({ toast }: { toast: (m: string) => void }) => {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'finished'>('all');

  useEffect(() => {
    api.history().then(
      (r) => {
        setEntries(r.entries);
        setCursor(r.nextCursor);
      },
      () => setEntries([])
    );
  }, []);

  if (open) return <GameViewer id={open} onBack={() => setOpen(null)} toast={toast} />;
  if (!entries) return <Card className="text-center text-zinc-500 py-16">Loading your moves…</Card>;
  if (!entries.length)
    return <Card className="text-center text-zinc-500 py-12">You haven't played any moves yet.</Card>;

  const shown = entries.filter((e) =>
    filter === 'all' ? true : filter === 'pending' ? e.outcome === null : e.outcome !== null
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(['all', 'pending', 'finished'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-sm cursor-pointer ${filter === f ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-400'}`}
          >
            {f === 'all' ? 'All' : f === 'pending' ? 'In play' : 'Finished'}
          </button>
        ))}
      </div>
      {shown.map((e) => (
        <button
          key={e.gameId}
          type="button"
          onClick={() => setOpen(e.gameId)}
          className="w-full text-left rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-black/5 dark:ring-white/10 p-3 flex items-center gap-3 cursor-pointer hover:ring-[#ff4500]/50"
        >
          <ColorDot color={e.color} />
          <div className="flex-1 min-w-0">
            <div className="font-mono font-bold text-zinc-900 dark:text-white">{moveLabel(e.ply, e.san)}</div>
            <div className="text-xs text-zinc-500 truncate">
              Game #{e.gameId.slice(1)} · {timeAgo(e.playedAt)} ·{' '}
              {e.status === 'finished' ? `${e.result} after ${e.totalPlies} plies` : `${e.totalPlies} plies so far`}
            </div>
          </div>
          <OutcomeBadge outcome={e.outcome} />
        </button>
      ))}
      {cursor !== null && (
        <Btn
          kind="secondary"
          className="w-full"
          onClick={() =>
            void api.history(cursor).then((r) => {
              setEntries([...entries, ...r.entries]);
              setCursor(r.nextCursor);
            })
          }
        >
          Load more
        </Btn>
      )}
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
  if (!data) return <Card className="text-center text-zinc-500 py-16">Loading…</Card>;
  return (
    <Card className="p-0 overflow-hidden">
      <p className="text-xs text-zinc-500 px-4 pt-3 pb-2">
        Ranked by win rate · at least {data.minGames} finished games
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
              <td className="py-2 px-2 text-xs text-zinc-500 tabular-nums whitespace-nowrap">
                {e.wins}/{e.draws}/{e.losses}
              </td>
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
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Seed fake games — you are dropped into about two thirds of them, so "My moves" and your win rate fill up. Bots
        then keep playing open boards so you can watch games finish.
      </p>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={busy} onClick={() => void run('Seeding', async () => {
          const r = await api.seed();
          return `Seeded ${r.games} games (${r.finished} finished)`;
        })}>
          Seed demo games
        </Btn>
        <Btn kind="secondary" disabled={busy} onClick={() => void run('Bots are thinking', async () => {
          const r = await api.simulate(60);
          return `Bots played ${r.played} moves · ${r.finished} games ended`;
        })}>
          Simulate 60 bot moves
        </Btn>
        <Btn kind="ghost" disabled={busy} onClick={() => void run('Resetting', async () => {
          const r = await api.reset();
          return `Deleted ${r.games} games`;
        })}>
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
    api.me().then(setMe, (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);
  useEffect(refreshMe, [refreshMe]);

  if (error)
    return <div className="min-h-screen flex items-center justify-center p-6 text-center text-zinc-600">{error}</div>;
  if (!me) return <div className="min-h-screen flex items-center justify-center text-zinc-500">Loading…</div>;

  const tabs: [Tab, string][] = [
    ['play', 'Play'],
    ['history', 'My moves'],
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
          <span className="text-xs text-zinc-500">u/{me.username}{isLocal ? ' · local' : ''}</span>
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
          {tab === 'history' && <HistoryTab toast={toast} />}
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
