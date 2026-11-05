import { useMemo, useState } from 'react';
import { useStore, uid } from '../../store';
import { today, fmtLong } from '../../lib/dates';
import type { Workout, WorkoutSet } from '../../types';
import { SectionHeader } from '../../components/ui';
import { IconClose } from '../../components/icons';
import { computePRs, exerciseNames, lastSession, fmtSet, norm, num, PR_LABEL, shortDate, prBoard, unitSuffix, type PlanSession, type Plan, type Unit } from './lib';

const dayOf = () => (new Date().getDay());
const bump = (v: string, d: number, min = 0) => { const n = Math.max(min, Math.round(((Number(v) || 0) + d) * 100) / 100); return String(n); };
const volumeOf = (w?: Workout) => (w ? w.sets.reduce((a, s) => a + (s.unit === 'kg' ? s.weight * s.reps : 0), 0) : 0);
const fmtVol = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString('en-IN'));

export default function LogTab({ planned, plan, onClearPlanned }: { planned: PlanSession | null; plan: Plan; onClearPlanned: () => void }) {
  const workouts = useStore((s) => s.workouts);
  const habitLogs = useStore((s) => s.habitLogs);
  const upsert = useStore((s) => s.upsert);
  const addXP = useStore((s) => s.addXP);
  const logHabit = useStore((s) => s.logHabit);
  const date = today();

  const workout = [...workouts].reverse().find((w) => w.date === date);
  const finished = habitLogs.some((l) => l.habitId === 'gym' && l.date === date && l.level === 'full');
  const prs = useMemo(() => computePRs(workouts), [workouts]);
  const names = useMemo(() => exerciseNames(workouts), [workouts]);
  const board = useMemo(() => prBoard(workouts), [workouts]);

  const todays = plan.sessions.find((s) => s.days.includes(dayOf()));
  const [startName, setStartName] = useState('');
  const [ex, setEx] = useState(''); const [reps, setReps] = useState(''); const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<Unit>('kg');
  const [editing, setEditing] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const last = lastSession(workouts, ex, workout?.id);
  const best = board.find((b) => norm(b.exercise) === norm(ex) && b.unit === unit);

  const start = () => {
    const name = startName.trim() || planned?.name || todays?.name || 'Training';
    upsert('workouts', { id: uid(), date, name, sets: [] });
  };

  const awardPRs = (set: WorkoutSet) => {
    const st = useStore.getState();
    const types = computePRs(st.workouts).get(set.id);
    if (!types) return;
    for (const t of types) {
      const ref = `pr:${set.exercise}:${date}:${t}`;
      if (!st.xp.some((e) => e.ref === ref)) addXP({ date, stat: 'body', amount: 15, reason: `PR: ${set.exercise}`, ref });
    }
    setFlash(`New PR · ${set.exercise} · ${types.map((t) => PR_LABEL[t]).join(', ')}`);
    window.setTimeout(() => setFlash(null), 3500);
  };

  const canSave = ex.trim() && Number(reps) > 0 && (unit !== 'kg' || weight !== '');
  const submit = () => {
    if (!workout || !canSave) return;
    const set: WorkoutSet = { id: editing ?? uid(), exercise: ex.trim(), reps: Number(reps), weight: unit === 'kg' ? Number(weight) : 0, unit };
    const w: Workout = { ...workout, sets: editing ? workout.sets.map((s) => (s.id === editing ? set : s)) : [...workout.sets, set] };
    upsert('workouts', w);
    awardPRs(set);
    setEditing(null);
  };
  const edit = (s: WorkoutSet) => { setEditing(s.id); setEx(s.exercise); setReps(String(s.reps)); setWeight(s.unit === 'kg' ? String(s.weight) : ''); setUnit(s.unit); };
  const cancelEdit = () => { setEditing(null); };
  const del = (id: string) => { if (workout) upsert('workouts', { ...workout, sets: workout.sets.filter((s) => s.id !== id) }); if (editing === id) setEditing(null); };
  const pick = (name: string, r?: number, u?: Unit) => {
    setEx(name); if (r) setReps(String(r)); if (u) setUnit(u);
    if (!u) { const l = lastSession(workouts, name, workout?.id); if (l) { setUnit(l.sets[0].unit); setWeight(l.sets[0].unit === 'kg' ? String(l.sets[0].weight) : ''); } }
    else if (u !== 'kg') setWeight('');
  };

  const past = workouts.filter((w) => w.date !== date && w.sets.length).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const countFor = (name: string) => workout?.sets.filter((s) => norm(s.exercise) === norm(name)).length ?? 0;

  if (!workout) {
    return (
      <div className="gym-stack">
        <section className="card gym-hero gym-rise">
          <div className="label">{fmtLong(date)}</div>
          <h2 className="display gym-hero-title">{todays ? todays.name : 'No session planned'}</h2>
          <p className="gym-muted">{todays && todays.exercises.length ? `${todays.exercises.length} exercises planned for today.` : 'Start an open session and log sets as you go.'}</p>
          <div className="gym-start-row">
            <input className="gym-input" placeholder="Session name (optional)" value={startName} onChange={(e) => setStartName(e.target.value)} />
            <button className="gym-btn" onClick={start}>Start workout</button>
          </div>
        </section>
        <History past={past} />
      </div>
    );
  }

  const vol = volumeOf(workout);
  return (
    <div className="gym-stack">
      <section className="card gym-hero gym-rise">
        <div className="gym-hero-top">
          <div className="label">{fmtLong(date)}{finished ? ' · finished' : ''}</div>
          {finished
            ? <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={() => logHabit('gym', date, null)}>Reopen</button>
            : <button className="gym-btn gym-btn-sm" disabled={!workout.sets.length} onClick={() => { logHabit('gym', date, 'full'); onClearPlanned(); }}>Finish workout</button>}
        </div>
        <h2 className="display gym-hero-title">{workout.name}</h2>
        <div className="gym-hero-stats">
          <div><div className="display gym-big-num">{workout.sets.length}</div><div className="label">Sets</div></div>
          <div><div className="display gym-big-num">{fmtVol(vol)}<span className="gym-big-u">kg</span></div><div className="label">Volume</div></div>
        </div>
      </section>

      {planned && planned.exercises.length > 0 && (
        <section className="gym-rise" style={{ ['--d' as string]: '60ms' }}>
          <SectionHeader label={`Planned · ${planned.name}`} />
          <div className="gym-chips">
            {planned.exercises.map((p) => {
              const n = countFor(p.name);
              return (
                <button key={p.id} className={`gym-chip ${n >= p.sets ? 'done' : ''}`} onClick={() => pick(p.name, p.reps, p.unit)}>
                  <span>{p.name || 'Unnamed'}</span>
                  <span className="gym-chip-meta">{n}/{p.sets} × {p.reps}{p.unit === 'sec' ? 's' : ''}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="card gym-entry gym-rise" style={{ ['--d' as string]: '100ms' }}>
        <div className="gym-entry-head"><span className="label">{editing ? 'Edit set' : 'Add set'}</span>{flash && <span className="gym-flash" role="status"><span className="gym-pr">PR</span>{flash.replace('New PR · ', '')}</span>}</div>
        <input className="gym-input gym-ex" list="gym-names" placeholder="Exercise" value={ex} onChange={(e) => { setEx(e.target.value); const l = lastSession(workouts, e.target.value, workout.id); if (l && !editing && names.some((n) => norm(n) === norm(e.target.value))) { setUnit(l.sets[0].unit); if (l.sets[0].unit === 'kg') setWeight(String(l.sets[0].weight)); } }} autoCapitalize="sentences" />
        <datalist id="gym-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="gym-seg" role="group" aria-label="Unit" style={{ ['--n' as string]: 3, ['--i' as string]: ['kg', 'bw', 'sec'].indexOf(unit) }}>
          <span className="gym-seg-thumb" aria-hidden="true" />
          {(['kg', 'bw', 'sec'] as Unit[]).map((u) => <button key={u} className={unit === u ? 'on' : ''} onClick={() => setUnit(u)}>{u === 'kg' ? 'Weighted' : u === 'bw' ? 'Bodyweight' : 'Hold'}</button>)}
        </div>
        {ex.trim() && (last || best) && (
          <div className="gym-hint">
            {last && <div><span className="label">Last · {shortDate(last.date)}</span> <span className="gym-hint-v">{last.sets.map(fmtSet).join('  ·  ')}</span></div>}
            {best && <div><span className="label">Best</span> <span className="gym-hint-v">{num(best.value)} {unitSuffix(best.unit)}{best.unit === 'kg' ? ` × ${best.reps}` : ''}</span></div>}
          </div>
        )}
        <div className="gym-steppers">
          <div className="gym-step">
            <span className="label">{unit === 'sec' ? 'Seconds' : 'Reps'}</span>
            <div className="gym-step-row">
              <button type="button" className="gym-step-btn" aria-label="Decrease" onClick={() => setReps(bump(reps, unit === 'sec' ? -5 : -1))}>−</button>
              <input className="display" inputMode="numeric" pattern="[0-9]*" value={reps} onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" aria-label={unit === 'sec' ? 'Seconds' : 'Reps'} />
              <button type="button" className="gym-step-btn" aria-label="Increase" onClick={() => setReps(bump(reps, unit === 'sec' ? 5 : 1))}>+</button>
            </div>
          </div>
          {unit === 'kg' && (
            <div className="gym-step">
              <span className="label">Weight · kg</span>
              <div className="gym-step-row">
                <button type="button" className="gym-step-btn" aria-label="Decrease" onClick={() => setWeight(bump(weight, -2.5))}>−</button>
                <input className="display" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" aria-label="Weight in kg" />
                <button type="button" className="gym-step-btn" aria-label="Increase" onClick={() => setWeight(bump(weight, 2.5))}>+</button>
              </div>
            </div>
          )}
        </div>
        <div className="gym-entry-actions">
          <button className="gym-btn gym-btn-lg" disabled={!canSave} onClick={submit}>{editing ? 'Save set' : 'Log set'}</button>
          {editing && <button className="gym-btn gym-btn-ghost gym-btn-lg" onClick={cancelEdit}>Cancel</button>}
        </div>
      </section>

      <section className="gym-rise" style={{ ['--d' as string]: '140ms' }}>
        <SectionHeader label={`Sets · ${workout.sets.length}`} />
        {workout.sets.length === 0 ? <div className="gym-empty">No sets yet. Your first one is the hardest.</div> : (
          <ol className="gym-sets">
            {workout.sets.map((s, i) => {
              const t = prs.get(s.id);
              return (
                <li key={s.id} className={`gym-set ${editing === s.id ? 'editing' : ''}`}>
                  <span className="gym-set-i display">{i + 1}</span>
                  <button className="gym-set-main" onClick={() => edit(s)} aria-label={`Edit ${s.exercise}`}>
                    <span className="gym-set-ex">{s.exercise}</span>
                    <span className="gym-set-v mono">{fmtSet(s)}</span>
                  </button>
                  {t && <span className="gym-pr" title={t.map((x) => PR_LABEL[x]).join(', ')}>PR</span>}
                  <button className="gym-x" onClick={() => del(s.id)} aria-label="Delete set"><IconClose size={16} /></button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <History past={past} />
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
