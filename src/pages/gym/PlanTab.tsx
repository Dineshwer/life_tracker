import { SectionHeader } from '../../components/ui';
import { IconClose, IconPlus } from '../../components/icons';
import { uid } from '../../store';
import { today } from '../../lib/dates';
import type { Plan, PlanSession, PlanExercise, Unit } from './lib';
import { programPlan } from './lib';
import { TARGETS } from './program';
import { DemoThumb } from './demos';
import { useState } from 'react';

const START_KEY = 'ledger-gym-start';
const startDate = (): string => { try { const v = localStorage.getItem(START_KEY); if (v) return v; localStorage.setItem(START_KEY, today()); } catch { /* ignore */ } return today(); };

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DL: Record<number, string> = { 0: 'S', 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S' };
const DN: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

export default function PlanTab({ plan, setPlan, onStart, onDemo, onOpenMobility }: { plan: Plan; setPlan: (p: Plan) => void; onStart: (s: PlanSession) => void; onDemo: (k: string) => void; onOpenMobility: () => void }) {
  const [start, setStart] = useState(startDate);
  const days = Math.floor((new Date(today().replace(/-/g, '/')).getTime() - new Date(start.replace(/-/g, '/')).getTime()) / 86400000);
  const wk = Math.min(12, Math.max(1, Math.floor(days / 7) + 1));
  const tgt = TARGETS[wk - 1];
  const restart = () => { try { localStorage.setItem(START_KEY, today()); } catch { /* ignore */ } setStart(today()); };
  const patch = (id: string, f: (s: PlanSession) => PlanSession) => setPlan({ sessions: plan.sessions.map((s) => (s.id === id ? f(s) : s)) });
  const patchEx = (sid: string, eid: string, p: Partial<PlanExercise>) => patch(sid, (s) => ({ ...s, exercises: s.exercises.map((e) => (e.id === eid ? { ...e, ...p } : e)) }));
  const todayDow = new Date(today().replace(/-/g, '/')).getDay();

  return (
    <div>
      <section className="card gym-design gym-rise">
        <span className="label gym-design-k">Week {wk} of 12 · {tgt.phase}</span>
        <p className="display gym-design-t">Bench {tgt.bench} kg · Deadlift {tgt.deadlift} kg</p>
        <p className="gym-muted">{tgt.note || 'Add 2.5 kg when every set hits the top of the range with 2 reps left.'} Four workout days, two mobility days, one free day, and one easy exercise from the 1-10 list every day.</p>
        <div className="plan-actions">
          <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={restart}>Restart at week 1</button>
          <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={() => { if (window.confirm('Replace the plan with the original program? Your edits to it will be lost.')) setPlan(programPlan()); }}>Reset to program</button>
        </div>
      </section>

      <SectionHeader label="Week" />
      <div className="card gym-week">
        {DAYS.map((d) => {
          const ss = plan.sessions.filter((s) => s.days.includes(d));
          return (
            <div key={d} className={`gym-week-day ${d === todayDow ? 'today' : ''}`}>
              <span className="label">{DN[d]}</span>
              <span className="gym-week-s">{ss.length ? ss.map((s) => s.name).join(', ') : '—'}</span>
            </div>
          );
        })}
      </div>

      <SectionHeader label="Sessions" />
      <div className="gym-sessions">
        {plan.sessions.map((s) => (
          <section key={s.id} className="card gym-session gym-rise">
            <div className="gym-session-h">
              <input className="gym-title-input display" value={s.name} onChange={(e) => patch(s.id, (x) => ({ ...x, name: e.target.value }))} aria-label="Session name" />
              {s.kind === 'mobility'
                ? <button className="gym-btn gym-btn-ghost" onClick={onOpenMobility}>Open mobility</button>
                : s.kind === 'free' ? null : <button className="gym-btn gym-btn-ghost" onClick={() => onStart(s)}>Start</button>}
            </div>
            {s.blurb && <p className="gym-muted plan-blurb">{s.blurb}</p>}
            <div className="gym-days" role="group" aria-label="Weekdays">
              {DAYS.map((d) => (
                <button key={d} className={s.days.includes(d) ? 'on' : ''} aria-pressed={s.days.includes(d)} aria-label={DN[d]}
                  onClick={() => patch(s.id, (x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d] }))}>{DL[d]}</button>
              ))}
            </div>
            {s.exercises.length === 0 && <div className="gym-empty">An empty slot, waiting for its first exercise.</div>}
            <ul className="gym-plan-ex">
              {s.exercises.map((e) => (
                <li key={e.id}>
                  <div className="plan-ex-top">
                    <DemoThumb k={e.demo} onOpen={onDemo} size={52} />
                    <div className="plan-ex-name">
                      <input className="gym-input" placeholder="Exercise" value={e.name} onChange={(ev) => patchEx(s.id, e.id, { name: ev.target.value })} />
                      {(e.text || e.note) && <div className="plan-ex-text">{e.one && <span className="chip mono">one</span>}{e.text}{e.text && e.note ? ' · ' : ''}{e.note}</div>}
                    </div>
                  </div>
                  <div className="gym-plan-nums">
                    <input className="gym-mini" inputMode="numeric" value={e.sets} aria-label="Sets" onChange={(ev) => patchEx(s.id, e.id, { sets: Number(ev.target.value.replace(/\D/g, '')) })} />
                    <span className="gym-x-sep">×</span>
                    <input className="gym-mini" inputMode="numeric" value={e.reps} aria-label={e.unit === 'sec' ? 'Seconds' : 'Reps'} onChange={(ev) => patchEx(s.id, e.id, { reps: Number(ev.target.value.replace(/\D/g, '')) })} />
                    <select className="gym-select" value={e.unit} aria-label="Unit" onChange={(ev) => patchEx(s.id, e.id, { unit: ev.target.value as Unit })}>
                      <option value="kg">weighted</option><option value="bw">bodyweight</option><option value="sec">hold (s)</option>
                    </select>
                    <button className="gym-x" aria-label="Remove exercise" onClick={() => patch(s.id, (x) => ({ ...x, exercises: x.exercises.filter((y) => y.id !== e.id) }))}><IconClose size={16} /></button>
                  </div>
                </li>
              ))}
            </ul>
            <button className="gym-add" onClick={() => patch(s.id, (x) => ({ ...x, exercises: [...x.exercises, { id: uid(), name: '', sets: 3, reps: 5, unit: 'bw' }] }))}><IconPlus size={16} /> Add exercise</button>
          </section>
        ))}
      </div>
      <button className="gym-add" onClick={() => setPlan({ sessions: [...plan.sessions, { id: uid(), name: `Session ${plan.sessions.length + 1}`, days: [], exercises: [] }] })}><IconPlus size={16} /> Add session</button>
    </div>
  );
}
