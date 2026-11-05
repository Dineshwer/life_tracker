import { useMemo, useRef, useState } from 'react';
import type { Task, TaskContext } from '../types';
import { Page, Ring, Button } from '../components/ui';
import { IconPlus } from '../components/icons';
import { useStore, uid } from '../store';
import { addDays, fromISO, today } from '../lib/dates';
import { TASK_XP } from '../lib/xp';
import TaskSheet, { CONTEXTS } from './tasks/TaskSheet';
import './tasks/tasks.css';

type View = 'today' | 'upcoming' | 'goals' | 'done';
const VIEWS: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'goals', label: 'Goals' }, { id: 'done', label: 'Done' },
];
const CTX_COLOR: Record<TaskContext, string> = { job: 'var(--mind)', agency: 'var(--skill)', personal: 'var(--accent)', learning: 'var(--discipline)' };

const dayDiff = (d: string) => Math.round((fromISO(d).getTime() - fromISO(today()).getTime()) / 864e5);
const shortDate = (d: string) => fromISO(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const dateHeading = (d: string) => {
  if (d === addDays(today(), 1)) return 'Tomorrow';
  return fromISO(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
};
const relDue = (d: string) => {
  const n = dayDiff(d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n} days overdue`;
  if (n <= 14) return `in ${n} days`;
  return shortDate(d);
};

function Arc({ done, total }: { done: number; total: number }) {
  const r = 6.5, c = 2 * Math.PI * r;
  return (
    <span className="t-arc" title={`${done} of ${total} steps`}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${c * (done / total)} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      {done}/{total}
    </span>
  );
}

function Sketch({ kind }: { kind: 'desk' | 'horizon' | 'seed' | 'stack' | 'ahead' }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg className="t-sketch" viewBox="0 0 120 72" width="120" height="72" aria-hidden="true">
      {kind === 'desk' && <g {...p}><path d="M10 58 C40 56 80 60 110 57" /><path d="M44 57 L47 38 C47 36 69 36 69 38 L72 57" /><path d="M69 42 C77 42 78 52 70 52" /><path d="M54 33 C52 26 58 22 56 15" opacity=".6" /><path d="M62 33 C60 28 65 25 63 19" opacity=".6" /><path d="M92 57 C92 46 90 40 96 32 C102 40 98 48 92 57 Z" /><path d="M92 50 L96 42" /></g>}
      {kind === 'ahead' && <g {...p}><path d="M8 52 C30 44 50 56 72 48 C90 42 100 46 112 40" /><circle cx="84" cy="22" r="9" /><path d="M84 8 V4 M97 22 H101 M70 22 H66 M94 12 L97 9 M74 12 L71 9" /><path d="M20 62 C44 58 76 64 104 60" opacity=".5" /></g>}
      {kind === 'horizon' && <g {...p}><path d="M6 56 L38 28 L56 44 L74 22 L114 56 Z" /><path d="M74 22 L68 32 L74 30 L80 34" opacity=".6" /><circle cx="26" cy="16" r="6" /></g>}
      {kind === 'seed' && <g {...p}><path d="M60 62 V34" /><path d="M60 44 C48 44 42 36 42 28 C52 28 60 34 60 44 Z" /><path d="M60 36 C70 36 76 28 76 20 C66 20 60 26 60 36 Z" /><path d="M36 62 H84" /><path d="M46 66 H74" opacity=".5" /></g>}
      {kind === 'stack' && <g {...p}><path d="M24 58 H96" /><path d="M30 58 V46 H90 V58" /><path d="M36 46 V36 H84 V46" /><path d="M44 36 V28 H76 V36" /><path d="M52 40 L58 45 L68 33" opacity=".7" /></g>}
    </svg>
  );
}
const Empty = ({ kind, children }: { kind: Parameters<typeof Sketch>[0]['kind']; children: string }) => (
  <div className="t-empty"><Sketch kind={kind} /><p>{children}</p></div>
);

function Row({ task, subs, onEdit, onComplete, i }: { task: Task; subs: Task[]; onEdit: (t: Task) => void; onComplete: (id: string) => void; i: number }) {
  const toggle = useStore((s) => s.toggleTask);
  const [xp, setXp] = useState(false);
  const timer = useRef<number>();
  const overdue = !task.done && !!task.date && task.date < today();
  const doneSubs = subs.filter((s) => s.done).length;
  const complete = () => {
    if (!task.done) {
      setXp(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setXp(false), 1500);
      onComplete(task.id);
    }
    toggle(task.id);
  };
  return (
    <div className={`t-row fx${task.done ? ' done' : ''}`} style={{ ['--i' as string]: i }}>
      <Ring state={task.done ? 'full' : 'none'} label={`Complete ${task.title}`} onClick={complete} color={CTX_COLOR[task.context]} />
      <div className="t-main">
        <button className="t-hit" onClick={() => onEdit(task)}>
          <span className="t-title"><span className="t-text">{task.title}</span></span>
          <span className="t-meta">
            <span className="t-ctx" style={{ ['--c' as string]: CTX_COLOR[task.context] }}>{task.context}</span>
            {task.date && <span className={`t-due${overdue ? ' over' : ''}`}>{relDue(task.date)}</span>}
            {subs.length > 0 && <Arc done={doneSubs} total={subs.length} />}
            {task.recurrence && <span className="t-rec">Every {task.recurrence.interval > 1 ? task.recurrence.interval + ' ' : ''}{task.recurrence.every}{task.recurrence.interval > 1 ? 's' : ''}</span>}
            {task.tags.map((g) => <span className="t-tag" key={g}>#{g}</span>)}
          </span>
        </button>
        {subs.length > 0 && (
          <div className="t-sub">
            {subs.map((s) => (
              <div className={`t-subrow${s.done ? ' done' : ''}`} key={s.id}>
                <Ring state={s.done ? 'full' : 'none'} label={`Complete ${s.title}`} onClick={() => toggle(s.id)} color={CTX_COLOR[task.context]} />
                <span className="t-text">{s.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {xp && <span className="t-xp" aria-hidden="true">+{TASK_XP[task.effort]} XP</span>}
    </div>
  );
}

export default function Tasks() {
  const tasks = useStore((s) => s.tasks);
  const upsert = useStore((s) => s.upsert);
  const [view, setView] = useState<View>('today');
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [sheet, setSheet] = useState(false);
  const [linger, setLinger] = useState<Set<string>>(new Set());
  const onComplete = (id: string) => {
    setLinger((l) => new Set(l).add(id));
    window.setTimeout(() => setLinger((l) => { const n = new Set(l); n.delete(id); return n; }), 1300);
  };

  const t0 = today();
  const subsOf = useMemo(() => {
    const m = new Map<string, Task[]>();
    tasks.forEach((t) => { if (t.parentId) m.set(t.parentId, [...(m.get(t.parentId) ?? []), t]); });
    return m;
  }, [tasks]);
  const tags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags))].sort(), [tasks]);

  const open = (t: Task) => !t.done || linger.has(t.id);
  const top = tasks.filter((t) => !t.parentId && (!ctx || t.context === ctx) && (!tag || t.tags.includes(tag)));
  const isGoal = (t: Task) => t.horizon === 'short' || t.horizon === 'long';
  const todayList = top.filter((t) => open(t) && !isGoal(t) && (!t.date || t.date <= t0)).sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9'));
  const upcoming = top.filter((t) => open(t) && !isGoal(t) && t.date && t.date > t0).sort((a, b) => a.date!.localeCompare(b.date!));
  const goals = top.filter((t) => open(t) && isGoal(t));
  const done = top.filter((t) => t.done && !linger.has(t.id)).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')).slice(0, 60);
  const counts: Record<View, number> = { today: todayList.length, upcoming: upcoming.length, goals: goals.length, done: done.length };

  const capture = () => {
    const title = draft.trim();
    if (!title) return;
    upsert('tasks', {
      id: uid(), title, done: false, context: ctx ?? 'personal', tags: tag ? [tag] : [], effort: 2, stat: 'discipline',
      ...(view === 'goals' ? { horizon: 'short' as const } : { date: view === 'upcoming' ? addDays(t0, 1) : t0 }),
    });
    setDraft('');
  };
  const edit = (t: Task) => { setEditing(t); setSheet(true); };
  const renderRows = (list: Task[]) => <div className="t-list card">{list.map((t, i) => <Row key={t.id} i={i} task={t} subs={subsOf.get(t.id) ?? []} onEdit={edit} onComplete={onComplete} />)}</div>;

  const groups: [string, Task[]][] = [];
  upcoming.forEach((t) => {
    const last = groups[groups.length - 1];
    if (last && last[0] === t.date) last[1].push(t); else groups.push([t.date!, [t]]);
  });
  const overdue = todayList.filter((t) => t.date && t.date < t0);
  const dueToday = todayList.filter((t) => !t.date || t.date >= t0);

  return (
    <Page title="Tasks" kicker="Work, in order" actions={<Button variant="ghost" onClick={() => { setEditing(null); setSheet(true); }}><IconPlus size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />New</Button>}>
      <div className="composer card fx" style={{ ['--i' as string]: 0 }}>
        <span className="composer-plus"><IconPlus size={18} /></span>
        <input value={draft} placeholder={view === 'goals' ? 'Name a goal worth chasing' : 'What needs doing?'} aria-label="Capture a task"
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') capture(); }} />
        <button className="kbd" onClick={capture} disabled={!draft.trim()} aria-label="Add task"><kbd>Enter</kbd><span>to add</span></button>
      </div>

      <div className="t-seg fx" style={{ ['--i' as string]: 1, ['--n' as string]: VIEWS.length, ['--k' as string]: VIEWS.findIndex((v) => v.id === view) }} role="tablist">
        <span className="t-seg-thumb" aria-hidden="true" />
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
            {v.label}{counts[v.id] > 0 && <sup>{counts[v.id]}</sup>}
          </button>
        ))}
      </div>

      <div className="chips fx" style={{ ['--i' as string]: 2 }}>
        <button className={`chip${!ctx ? ' on' : ''}`} onClick={() => setCtx(null)}>All</button>
        {CONTEXTS.map((c) => <button key={c} className={`chip${ctx === c ? ' on' : ''}`} style={{ ['--c' as string]: CTX_COLOR[c] }} onClick={() => setCtx(ctx === c ? null : c)}><i />{c}</button>)}
        {tags.length > 0 && <span className="sep" />}
        {tags.map((g) => <button key={g} className={`chip tagchip${tag === g ? ' on' : ''}`} onClick={() => setTag(tag === g ? null : g)}>#{g}</button>)}
      </div>

      <div key={view} className="t-view">
      {view === 'today' && (
        todayList.length === 0 ? <Empty kind="desk">Nothing due. A clear desk.</Empty> : (
          <>
            {overdue.length > 0 && <section className="t-group"><h3 className="over">Overdue<small>{overdue.length}</small></h3>{renderRows(overdue)}</section>}
            {dueToday.length > 0 && <section className="t-group"><h3>Today<small>{dueToday.length}</small></h3>{renderRows(dueToday)}</section>}
          </>
        )
      )}

      {view === 'upcoming' && (
        groups.length === 0 ? <Empty kind="ahead">Nothing scheduled ahead. Open road.</Empty> :
          groups.map(([d, list]) => <section className="t-group" key={d}><h3>{dateHeading(d)}<small>{shortDate(d)}</small></h3>{renderRows(list)}</section>)
      )}

      {view === 'goals' && (
        goals.length === 0 ? <Empty kind="seed">No goals yet. Plant one above.</Empty> : (
          (['short', 'long'] as const).map((h) => {
            const l = goals.filter((t) => t.horizon === h);
            return l.length ? <section className="t-group" key={h}><h3>{h === 'short' ? 'Short horizon' : 'Long horizon'}<small>{l.length}</small></h3>{renderRows(l)}</section> : null;
          })
        )
      )}

      {view === 'done' && (done.length === 0 ? <Empty kind="stack">Completed work will gather here.</Empty> : <section className="t-group">{renderRows(done)}</section>)}
      </div>

      <TaskSheet open={sheet} task={editing} onClose={() => setSheet(false)}
        defaults={{ date: view === 'goals' ? undefined : t0, context: ctx ?? 'personal', horizon: view === 'goals' ? 'short' : undefined }} />
    </Page>
  );
}
