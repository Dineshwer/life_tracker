import { useState } from 'react';
import { SectionHeader } from '../../components/ui';
import { useStore } from '../../store';
import { today } from '../../lib/dates';
import { MOBILITY, type MobRoutine } from './program';
import { DemoThumb } from './demos';

const key = (d: string) => `ledger-mobility-${d}`;
const read = (d: string): string[] => { try { return JSON.parse(localStorage.getItem(key(d)) ?? '[]'); } catch { return []; } };

export default function MobilityTab({ onDemo }: { onDemo: (k: string) => void }) {
  const d = today();
  const [done, setDone] = useState<string[]>(() => read(d));
  const [open, setOpen] = useState<string | null>(() => {
    const dow = new Date().getDay(); return dow === 3 ? 'wed' : dow === 0 ? 'sun' : 'primer';
  });
  const addXP = useStore((s) => s.addXP);
  const xp = useStore((s) => s.xp);

  const toggle = (r: MobRoutine, i: number) => {
    const id = `${r.id}:${i}`;
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next); try { localStorage.setItem(key(d), JSON.stringify(next)); } catch { /* ignore */ }
    // once all items of a routine are ticked, award a little Body XP for the day (never twice)
    const full = r.items.every((_, j) => next.includes(`${r.id}:${j}`));
    const ref = `mob:${r.id}:${d}`;
    if (full && !xp.some((e) => e.ref === ref)) addXP({ date: d, stat: 'body', amount: r.minutes >= 30 ? 20 : 8, reason: `${r.name} done`, ref });
  };

  return (
    <div className="gym-stack">
      <section className="card gym-design gym-rise">
        <span className="label gym-design-k">Mobility and flexibility</span>
        <p className="display gym-design-t">Every day, all seven.</p>
        <p className="gym-muted">Primer before training, a short stretch after, long holds in the evening. Static holds go after lifting, not before. Soreness is fine, tightness is not. Stretches from your reels are tagged with their source.</p>
      </section>
      {MOBILITY.map((r) => {
        const n = r.items.filter((_, i) => done.includes(`${r.id}:${i}`)).length;
        const isOpen = open === r.id;
        return (
          <section key={r.id} className="card mob gym-rise">
            <button className="mob-head" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
              <span><span className="display mob-name">{r.name}</span><span className="label mob-when">{r.when} · {r.minutes} min</span></span>
              <span className="mob-count mono">{n}/{r.items.length}</span>
            </button>
            {isOpen && (<>
              <p className="gym-muted mob-blurb">{r.blurb}</p>
              <ul className="mob-list">
                {r.items.map((it, i) => {
                  const on = done.includes(`${r.id}:${i}`);
                  return (
                    <li key={i} className={on ? 'on' : ''}>
                      <button className="mob-check" onClick={() => toggle(r, i)} aria-pressed={on} aria-label={`Mark ${it.name} done`}>{on ? '✓' : ''}</button>
                      <div className="mob-main">
                        <div className="mob-title">{it.name}<span className="mob-dose mono">{it.dose}</span></div>
                        {it.note && <div className="mob-note">{it.note}</div>}
                        <div className="label mob-src">{it.src}</div>
                      </div>
                      <DemoThumb k={it.demo} onOpen={onDemo} size={52} />
                    </li>
                  );
                })}
              </ul>
            </>)}
          </section>
        );
      })}
      <SectionHeader label="Tip" />
      <p className="gym-muted">Resets at midnight. Finishing a whole routine gives a little Body XP, once a day per routine.</p>
    </div>
  );
}
