import { useState } from 'react';
import { useStore } from '../../store';
import { today } from '../../lib/dates';
import { MOBILITY } from './program';
import { DemoBody } from './demos';
import { synced } from '../../lib/synced';

const key = (d: string) => `ledger-mobility-${d}`;
const read = (d: string): string[] => { try { return JSON.parse(synced.getItem(key(d)) ?? '[]'); } catch { return []; } };

/** Mobility drills as expandable rows. Open one, see how to do it, tick it. Shares progress with the Mobility tab. */
export default function DrillRows({ routineId, openId, setOpenId }: { routineId: string; openId: string | null | undefined; setOpenId: (id: string | null | undefined) => void }) {
  const r = MOBILITY.find((x) => x.id === routineId) ?? MOBILITY[0];
  const d = today();
  const [done, setDone] = useState<string[]>(() => read(d));
  const addXP = useStore((s) => s.addXP);
  const xp = useStore((s) => s.xp);
  const did = (i: number) => `${r.id}:${i}`;
  const firstOpen = r.items.findIndex((_, i) => !done.includes(did(i)));
  const openKey = openId === undefined ? (firstOpen >= 0 ? `d:${firstOpen}` : null) : openId;

  const set = (arr: string[]) => {
    setDone(arr); try { synced.setItem(key(d), JSON.stringify(arr)); } catch { /* ignore */ }
    const full = r.items.every((_, j) => arr.includes(did(j)));
    const ref = `mob:${r.id}:${d}`;
    if (full && !xp.some((e) => e.ref === ref)) addXP({ date: d, stat: 'body', amount: r.minutes >= 30 ? 20 : 8, reason: `${r.name} done`, ref });
  };
  const tick = (i: number) => { const on = done.includes(did(i)); set(on ? done.filter((x) => x !== did(i)) : [...done, did(i)]); if (!on) setOpenId(undefined); };
  const n = r.items.filter((_, i) => done.includes(did(i))).length;

  return (
    <section className="acc-group">
      <div className="acc-group-h"><span className="label">{r.name}</span><span className="label mono">{n}/{r.items.length}</span></div>
      <ol className="acc">
        {r.items.map((it, i) => {
          const on = done.includes(did(i)); const open = openKey === `d:${i}`;
          return (
            <li key={i} className={`acc-row ${on ? 'done' : ''} ${open ? 'open' : ''}`}>
              <button className="acc-h" aria-expanded={open} onClick={() => setOpenId(open ? null : `d:${i}`)}>
                <span className="lg-dot" aria-hidden>{on ? '✓' : i + 1}</span>
                <span className="acc-main"><span className="acc-name">{it.name}</span><span className="acc-sub mono">{it.dose}</span></span>
                <span className="acc-chev" aria-hidden>{open ? '−' : '+'}</span>
              </button>
              {open && (
                <div className="acc-body">
                  {it.note && <p className="gym-muted lg-note">{it.note}</p>}
                  <div className="lg-actions"><button className="gym-btn" onClick={() => tick(i)}>{on ? 'Undo' : 'Done, next'}</button><span className="label">{it.src}</span></div>
                  <DemoBody k={it.demo} autoVideo />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
