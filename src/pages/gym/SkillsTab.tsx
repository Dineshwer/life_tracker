import { useState } from 'react';
import { useStore } from '../../store';
import { today } from '../../lib/dates';
import { SKILLS } from './program';
import { DemoThumb } from './demos';

const KEY = 'ledger-gym-skills';
const read = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };

/** Skill ladders: tick a step when you pass its gate. Each unlock gives Skill XP once. */
export default function SkillsTab({ onDemo }: { onDemo: (k: string) => void }) {
  const [prog, setProg] = useState<Record<string, number>>(read);
  const addXP = useStore((s) => s.addXP);
  const xp = useStore((s) => s.xp);
  const set = (id: string, n: number) => {
    const next = { ...prog, [id]: n }; setProg(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const unlock = (id: string, name: string, i: number) => {
    const cur = prog[id] ?? 0;
    if (i + 1 === cur) { set(id, i); return; } // tap the last unlocked step again to undo it
    set(id, i + 1);
    const ref = `skill:${id}:${i}`;
    if (!xp.some((e) => e.ref === ref)) addXP({ date: today(), stat: 'skill', amount: 40, reason: `Unlocked: ${name}`, ref });
  };

  return (
    <div className="gym-stack">
      <section className="card gym-design gym-rise">
        <span className="label gym-design-k">Skill tree</span>
        <p className="display gym-design-t">Pass the gate, unlock the next step.</p>
        <p className="gym-muted">Tick a step only when you meet its gate with clean form. Planche and muscle-up work load your elbows and wrists heavily, so go slowly and stop on pain or tingling. Tap a thumbnail to see the form.</p>
      </section>
      {SKILLS.map((sk) => {
        const cur = prog[sk.id] ?? 0;
        return (
          <section key={sk.id} className="card skill gym-rise">
            <div className="skill-head"><span className="display skill-name">{sk.name}</span><span className="label">{cur}/{sk.steps.length}</span></div>
            <div className="gym-muted skill-goal">{sk.goal}</div>
            <ol className="skill-steps">
              {sk.steps.map((st, i) => {
                const state = i < cur ? 'done' : i === cur ? 'now' : 'next';
                return (
                  <li key={i} className={`skill-step ${state}`}>
                    <button className="mob-check" onClick={() => unlock(sk.id, st.name, i)} aria-pressed={i < cur} aria-label={i < cur ? `Undo ${st.name}` : `Unlock ${st.name}`}>{i < cur ? '✓' : i + 1}</button>
                    <div className="mob-main"><div className="mob-title">{st.name}</div><div className="mob-note">Gate: {st.gate}</div></div>
                    <DemoThumb k={st.demo} onOpen={onDemo} size={48} />
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
