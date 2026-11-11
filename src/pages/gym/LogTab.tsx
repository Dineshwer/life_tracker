import { useEffect, useMemo, useState } from 'react';
import { useStore, uid } from '../../store';
import { today, fmtLong } from '../../lib/dates';
import type { QueueItem, Workout, WorkoutSet } from '../../types';
import { SectionHeader } from '../../components/ui';
import { IconClose } from '../../components/icons';
import CardioCard from './CardioCard';
import DrillRows from './DrillRows';
import { DemoBody, findDemoKey, useDemos } from './demos';
import { computePRs, exerciseNames, fmtSet, lastSession, norm, num, PR_LABEL, queueFrom, shortDate, type Plan, type PlanSession, type Unit } from './lib';
import './log.css';

const volumeOf = (w?: Workout) => (w ? w.sets.reduce((a, s) => a + (s.unit === 'kg' ? s.weight * s.reps : 0), 0) : 0);
const fmtVol = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString('en-IN'));
const UNIT_LABEL: Record<Unit, string> = { kg: 'Weighted', bw: 'Bodyweight', sec: 'Hold' };
const num0 = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || 0;
const rxOf = (q: QueueItem) => q.text ?? `${q.sets} × ${q.reps}${q.unit === 'sec' ? ' s' : ''}`;

/** Today's plan, loaded automatically. Open an exercise, log its sets, and the how-to sits below. */
export default function LogTab({ plan, setPlan, onClearPlanned }: { planned?: PlanSession | null; plan: Plan; setPlan: (p: Plan) => void; onClearPlanned: () => void; onDemo?: (k: string) => void; onOpenMobility?: () => void }) {
  const workouts = useStore((s) => s.workouts);
  const habitLogs = useStore((s) => s.habitLogs);
  const upsert = useStore((s) => s.upsert);
  const addXP = useStore((s) => s.addXP);
  const logHabit = useStore((s) => s.logHabit);
  const date = today();
  const dow = new Date().getDay();
  const todays = plan.sessions.find((s) => s.days.includes(dow));
  const stored = [...workouts].reverse().find((w) => w.date === date);
  const finished = habitLogs.some((l) => l.habitId === 'gym' && l.date === date && l.level === 'full');
  const past = workouts.filter((w) => w.date !== date && w.sets.length).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);

  // Today's session exists from the moment you open the tab. It is only saved once you log something or change the list.
  const [virtId] = useState(uid);
  const fresh = useMemo(() => queueFrom(todays), [todays]);
  const workout: Workout = stored ?? { id: virtId, date, name: todays?.name ?? 'Training', sets: [], queue: fresh, planId: todays?.id };

  // A leftover session from another plan (or an empty list) is rebuilt from today's plan. Logged sets are kept visible.
  useEffect(() => {
    if (!stored || !todays) return;
    if (stored.planId === todays.id && (stored.queue?.length ?? 0) > 0) return;
    const planQ = queueFrom(todays);
    const extra = [...new Set(stored.sets.map((s) => s.exercise))].filter((n) => !planQ.some((q) => norm(q.name) === norm(n)))
      .map((n): QueueItem => { const s = stored.sets.find((x) => x.exercise === n)!; return { id: uid(), name: n, sets: stored.sets.filter((x) => x.exercise === n).length, reps: s.reps, unit: s.unit }; });
    upsert('workouts', { ...stored, name: todays.name, planId: todays.id, queue: [...planQ, ...extra] });
  }, [stored?.id, todays?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Day workout={workout} todays={todays} finished={finished} plan={plan} setPlan={setPlan}
      onFinish={() => { logHabit('gym', date, 'full'); onClearPlanned(); }} onReopen={() => logHabit('gym', date, null)}
      addXP={addXP} upsert={upsert} past={past} names={exerciseNames(workouts)} dow={dow} />
  );
}

interface DProps {
  workout: Workout; todays?: PlanSession; finished: boolean; plan: Plan; setPlan: (p: Plan) => void; dow: number;
  onFinish: () => void; onReopen: () => void;
  addXP: ReturnType<typeof useStore.getState>['addXP']; upsert: ReturnType<typeof useStore.getState>['upsert'];
  past: Workout[]; names: string[];
}

function Day({ workout, todays, finished, plan, setPlan, dow, onFinish, onReopen, addXP, upsert, past, names }: DProps) {
  const manifest = useDemos();
  const workouts = useStore((s) => s.workouts);
  const date = workout.date;
  const queue = workout.queue ?? [];
  const mobility = todays?.kind === 'mobility';
  const prs = useMemo(() => computePRs(workouts), [workouts]);
  // undefined = open the first unfinished row, null = everything closed, string = that row
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const countOf = (q: QueueItem) => workout.sets.filter((s) => norm(s.exercise) === norm(q.name)).length;
  const isDone = (q: QueueItem) => countOf(q) >= q.sets;
  const firstOpen = queue.find((q) => !q.skipped && !isDone(q));
  const openKey = openId === undefined ? (mobility ? null : firstOpen?.id ?? null) : openId;
  const mobOpenArg = openId === undefined ? undefined : openId;
  const doneN = queue.filter((q) => isDone(q)).length;

  const latest = () => useStore.getState().workouts.find((w) => w.id === workout.id) ?? workout;
  const saveWorkout = (patch: Partial<Workout>) => upsert('workouts', { ...latest(), ...patch });
  const setQueue = (qs: QueueItem[]) => saveWorkout({ queue: qs });
  const patchItem = (id: string, p: Partial<QueueItem>) => setQueue(queue.map((q) => (q.id === id ? { ...q, ...p } : q)));
  const flashMsg = (m: string, ms = 3500) => { setFlash(m); window.setTimeout(() => setFlash(null), ms); };

  const awardPRs = (set: WorkoutSet) => {
    const st = useStore.getState();
    const types = computePRs(st.workouts).get(set.id);
    if (!types) return;
    for (const t of types) {
      const ref = `pr:${set.exercise}:${date}:${t}`;
      if (!st.xp.some((e) => e.ref === ref)) addXP({ date, stat: 'body', amount: 15, reason: `PR: ${set.exercise}`, ref });
    }
    flashMsg(`New PR · ${set.exercise} · ${types.map((t) => PR_LABEL[t]).join(', ')}`);
  };
  const logSet = (q: QueueItem, reps: number, weight: number) => {
    const set: WorkoutSet = { id: uid(), exercise: q.name, reps, weight: q.unit === 'kg' ? weight : 0, unit: q.unit };
    const w = latest();
    upsert('workouts', { ...w, queue: w.queue ?? queue, sets: [...w.sets, set] });
    awardPRs(set);
    if (countOf(q) + 1 >= q.sets) setOpenId(undefined); // finished: open the next unfinished exercise
  };
  const editSet = (id: string, reps: number, weight: number) => saveWorkout({ sets: latest().sets.map((s) => (s.id === id ? { ...s, reps, weight: s.unit === 'kg' ? weight : 0 } : s)) });
  const delSet = (id: string) => saveWorkout({ sets: latest().sets.filter((s) => s.id !== id) });

  const addItem = (name: string, sets: number, reps: number, unit: Unit) => {
    const it: QueueItem = { id: uid(), name: name.trim(), sets, reps, unit, demo: findDemoKey(manifest, name) ?? undefined };
    setQueue([...queue, it]); setOpenId(it.id);
  };
  const removeItem = (id: string) => { setQueue(queue.filter((q) => q.id !== id)); if (openId === id) setOpenId(undefined); };
  const saveToPlan = () => {
    if (!workout.planId) return;
    setPlan({ sessions: plan.sessions.map((s) => (s.id === workout.planId ? { ...s, exercises: queue.map((q) => ({ id: q.id, name: q.name, sets: q.sets, reps: q.reps, unit: q.unit, demo: q.demo, text: q.text, note: q.note })) } : s)) });
    flashMsg('Saved to your plan', 2500);
  };
  const reload = () => {
    if (!todays || !window.confirm("Reload today's plan? Exercises you added or removed today are reset. Logged sets stay.")) return;
    setQueue(queueFrom(todays)); setOpenId(undefined);
  };

  const vol = volumeOf(workout);
  return (
    <div className="gym-stack">
      <section className="card gym-hero gym-rise">
        <div className="gym-hero-top">
          <div className="label">{fmtLong(date)}{finished ? ' · finished' : ''}</div>
          {mobility ? null : finished
            ? <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={onReopen}>Reopen</button>
            : <button className="gym-btn gym-btn-sm" disabled={!workout.sets.length} onClick={onFinish}>Finish workout</button>}
        </div>
        <h2 className="display gym-hero-title">{todays?.name ?? workout.name}</h2>
        {todays?.blurb && <p className="gym-muted">{mobility ? 'Open a drill, do it, tick it. Then log the one exercise below.' : todays.blurb}</p>}
        <div className="gym-hero-stats">
          <div><div className="display gym-big-num">{doneN}<span className="gym-big-u">/{queue.length}</span></div><div className="label">Exercises</div></div>
          <div><div className="display gym-big-num">{workout.sets.length}</div><div className="label">Sets</div></div>
          <div><div className="display gym-big-num">{fmtVol(vol)}<span className="gym-big-u">kg</span></div><div className="label">Volume</div></div>
        </div>
      </section>
      {flash && <div className="gym-flash lg-flash" role="status">{flash}</div>}

      {mobility && <DrillRows routineId={dow === 3 ? 'wed' : dow === 0 ? 'sun' : 'primer'} openId={mobOpenArg} setOpenId={setOpenId} />}

      <section className="acc-group">
        <div className="acc-group-h"><span className="label">{mobility ? "Today's one exercise" : "Today's exercises"}</span><span className="label mono">{doneN}/{queue.length}</span></div>
        {queue.length === 0 && <div className="lg-empty-row">{todays ? 'Nothing planned for today.' : 'No session planned today.'} Add an exercise below.</div>}
        <ol className="acc">
          {queue.map((q, i) => {
            const n = countOf(q); const done = isDone(q); const open = openKey === q.id;
            return (
              <li key={q.id} className={`acc-row ${done ? 'done' : ''} ${q.skipped ? 'skipped' : ''} ${open ? 'open' : ''}`}>
                <button className="acc-h" aria-expanded={open} onClick={() => { if (q.skipped) patchItem(q.id, { skipped: false }); setOpenId(open ? null : q.id); }}>
                  <span className="lg-dot" aria-hidden>{done ? '✓' : i + 1}</span>
                  <span className="acc-main"><span className="acc-name">{q.name}</span><span className="acc-sub mono">{q.skipped ? 'skipped' : rxOf(q)}</span></span>
                  <span className="acc-n mono">{n}/{q.sets}</span>
                  <span className="acc-chev" aria-hidden>{open ? '−' : '+'}</span>
                </button>
                {open && (
                  <ExerciseBody q={q} workout={workout} workouts={workouts} prs={prs} editing={editing === q.id} setEditing={(b) => setEditing(b ? q.id : null)}
                    onLog={(r, w) => logSet(q, r, w)} onEditSet={editSet} onDelSet={delSet} onPatch={(p) => patchItem(q.id, p)}
                    onSkip={() => { patchItem(q.id, { skipped: true }); setOpenId(undefined); }} onRemove={() => removeItem(q.id)} />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card lg-tools">
        <AddExercise names={names} manifest={manifest} onAdd={addItem} />
        <div className="lg-tools-row">
          {workout.planId && queue.length > 0 && <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={saveToPlan}>Save this list to the plan</button>}
          {todays && <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={reload}>Reload today's plan</button>}
        </div>
      </section>

      <CardioCard onDemo={() => {}} />
      <History past={past} />
    </div>
  );
}

// ------------------------------------------------------------------ open exercise: log first, how-to below

function ExerciseBody({ q, workout, workouts, prs, editing, setEditing, onLog, onEditSet, onDelSet, onPatch, onSkip, onRemove }: {
  q: QueueItem; workout: Workout; workouts: Workout[]; prs: Map<string, string[]>; editing: boolean; setEditing: (b: boolean) => void;
  onLog: (reps: number, weight: number) => void; onEditSet: (id: string, reps: number, weight: number) => void; onDelSet: (id: string) => void;
  onPatch: (p: Partial<QueueItem>) => void; onSkip: () => void; onRemove: () => void;
}) {
  const mine = workout.sets.filter((s) => norm(s.exercise) === norm(q.name));
  const last = lastSession(workouts, q.name, workout.id);
  const lastWeight = mine.length ? mine[mine.length - 1].weight : last?.sets[last.sets.length - 1]?.weight ?? 0;
  const rows = Math.max(q.sets, mine.length + 1);

  return (
    <div className="acc-body">
      {q.note && <p className="gym-muted lg-note">{q.note}</p>}
      {last && <div className="lg-last"><span className="label">Last · {shortDate(last.date)}</span> <span className="mono">{last.sets.map(fmtSet).join('  ·  ')}</span></div>}

      <ol className="lg-sets">
        {Array.from({ length: rows }, (_, i) => {
          const s = mine[i];
          if (s) return <LoggedRow key={s.id} i={i} s={s} pr={prs.get(s.id)} onSave={(r, w) => onEditSet(s.id, r, w)} onDel={() => onDelSet(s.id)} />;
          if (i === mine.length) return <EntryRow key={`e${i}`} i={i} q={q} defReps={q.reps} defWeight={lastWeight} onLog={onLog} />;
          return <li key={`u${i}`} className="lg-set up"><span className="lg-n mono">{i + 1}</span><span className="lg-target mono">{q.reps}{q.unit === 'sec' ? 's' : ''}{q.unit === 'kg' ? ` × ${lastWeight ? num(lastWeight) : '—'} kg` : ''}</span></li>;
        })}
      </ol>

      <div className="lg-body-actions">
        <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit'}</button>
        <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={onSkip}>Skip</button>
        <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={onRemove}>Remove from today</button>
      </div>
      {editing && (
        <div className="lg-edit">
          <input className="gym-input" value={q.name} aria-label="Exercise name" onChange={(e) => onPatch({ name: e.target.value })} />
          <div className="lg-edit-row">
            <label className="lg-f"><span className="label">Sets</span><input className="gym-mini" inputMode="numeric" value={q.sets} onChange={(e) => onPatch({ sets: Math.max(1, num0(e.target.value)) })} /></label>
            <label className="lg-f"><span className="label">{q.unit === 'sec' ? 'Seconds' : 'Reps'}</span><input className="gym-mini" inputMode="numeric" value={q.reps} onChange={(e) => onPatch({ reps: Math.max(1, num0(e.target.value)) })} /></label>
            <select className="gym-select" value={q.unit} aria-label="Unit" onChange={(e) => onPatch({ unit: e.target.value as Unit })}>{(['kg', 'bw', 'sec'] as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
          </div>
        </div>
      )}

      {q.demo && <div className="lg-demo"><div className="label">How to do it</div><DemoBody k={q.demo} /></div>}
    </div>
  );
}

function EntryRow({ i, q, defReps, defWeight, onLog }: { i: number; q: QueueItem; defReps: number; defWeight: number; onLog: (r: number, w: number) => void }) {
  const [reps, setReps] = useState(String(defReps));
  const [weight, setWeight] = useState(defWeight ? String(defWeight) : '');
  const ok = Number(reps) > 0 && (q.unit !== 'kg' || weight !== '');
  const step = (v: string, d: number) => String(Math.max(0, Math.round(((Number(v) || 0) + d) * 100) / 100));
  return (
    <li className="lg-set now">
      <span className="lg-n mono">{i + 1}</span>
      <div className="lg-inputs">
        {q.unit === 'kg' && <div className="lg-stepper"><button type="button" aria-label="Lighter" onClick={() => setWeight(step(weight, -2.5))}>−</button><input inputMode="decimal" value={weight} placeholder="0" aria-label="Weight in kg" onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ''))} /><button type="button" aria-label="Heavier" onClick={() => setWeight(step(weight, 2.5))}>+</button><span className="label">kg</span></div>}
        <div className="lg-stepper"><button type="button" aria-label="Fewer" onClick={() => setReps(step(reps, q.unit === 'sec' ? -5 : -1))}>−</button><input inputMode="numeric" value={reps} aria-label={q.unit === 'sec' ? 'Seconds' : 'Reps'} onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ''))} /><button type="button" aria-label="More" onClick={() => setReps(step(reps, q.unit === 'sec' ? 5 : 1))}>+</button><span className="label">{q.unit === 'sec' ? 'sec' : 'reps'}</span></div>
      </div>
      <button className="gym-btn lg-log" disabled={!ok} onClick={() => onLog(Number(reps), Number(weight) || 0)}>Log</button>
    </li>
  );
}

function LoggedRow({ i, s, pr, onSave, onDel }: { i: number; s: WorkoutSet; pr?: string[]; onSave: (r: number, w: number) => void; onDel: () => void }) {
  const [edit, setEdit] = useState(false);
  const [reps, setReps] = useState(String(s.reps)); const [weight, setWeight] = useState(String(s.weight || ''));
  useEffect(() => { setReps(String(s.reps)); setWeight(String(s.weight || '')); }, [s.reps, s.weight]);
  if (edit) return (
    <li className="lg-set now">
      <span className="lg-n mono">{i + 1}</span>
      <div className="lg-inputs">
        {s.unit === 'kg' && <div className="lg-stepper"><input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Weight" /><span className="label">kg</span></div>}
        <div className="lg-stepper"><input inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ''))} aria-label="Reps" /><span className="label">{s.unit === 'sec' ? 'sec' : 'reps'}</span></div>
      </div>
      <button className="gym-btn gym-btn-sm lg-log" onClick={() => { onSave(Number(reps) || s.reps, Number(weight) || 0); setEdit(false); }}>Save</button>
    </li>
  );
  return (
    <li className="lg-set done">
      <span className="lg-n mono">{i + 1}</span>
      <button className="lg-logged" onClick={() => setEdit(true)} aria-label="Edit this set"><span className="mono">{fmtSet(s)}</span>{pr && <span className="gym-pr" title={pr.map((x) => PR_LABEL[x as keyof typeof PR_LABEL]).join(', ')}>PR</span>}</button>
      <button className="gym-x" aria-label="Delete set" onClick={onDel}><IconClose size={14} /></button>
    </li>
  );
}

// ------------------------------------------------------------------ add / history

function AddExercise({ names, manifest, onAdd }: { names: string[]; manifest: Record<string, { name: string }>; onAdd: (name: string, sets: number, reps: number, unit: Unit) => void }) {
  const [name, setName] = useState(''); const [sets, setSets] = useState('3'); const [reps, setReps] = useState('8'); const [unit, setUnit] = useState<Unit>('kg');
  const options = [...new Set([...names, ...Object.values(manifest).map((m) => m.name)])];
  const go = () => { if (!name.trim()) return; onAdd(name, Math.max(1, num0(sets)), Math.max(1, num0(reps)), unit); setName(''); };
  return (
    <div className="lg-add">
      <div className="label lg-list-h">Add an exercise to today</div>
      <input className="gym-input" list="lg-names" placeholder="Exercise name" value={name} onChange={(e) => { setName(e.target.value); const l = lastSession(useStore.getState().workouts, e.target.value); if (l) setUnit(l.sets[0].unit); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
      <datalist id="lg-names">{options.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="lg-add-row">
        <input className="gym-mini" inputMode="numeric" value={sets} aria-label="Sets" onChange={(e) => setSets(e.target.value)} /><span className="gym-x-sep">×</span>
        <input className="gym-mini" inputMode="numeric" value={reps} aria-label="Reps" onChange={(e) => setReps(e.target.value)} />
        <select className="gym-select" value={unit} aria-label="Unit" onChange={(e) => setUnit(e.target.value as Unit)}>{(['kg', 'bw', 'sec'] as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
        <button className="gym-btn gym-btn-sm" disabled={!name.trim()} onClick={go}>Add</button>
      </div>
    </div>
  );
}

function History({ past }: { past: Workout[] }) {
  if (!past.length) return null;
  return (
    <div className="gym-rise" style={{ ['--d' as string]: '180ms' }}>
      <SectionHeader label="Recent sessions" />
      <ul className="gym-hist">
        {past.map((w) => (
          <li key={w.id} className="card">
            <div className="gym-hist-h"><span className="gym-set-ex">{w.name}</span><span className="label">{shortDate(w.date)} · {w.sets.length} sets</span></div>
            <div className="gym-hist-b">{[...new Set(w.sets.map((s) => s.exercise))].join(' · ')}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
