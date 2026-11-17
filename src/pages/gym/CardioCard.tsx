import { useState } from 'react';
import { useStore, uid } from '../../store';
import { today, weekDays } from '../../lib/dates';
import { CARDIO } from './program';
import { DemoThumb } from './demos';
import { synced } from '../../lib/synced';

interface Log { id: string; date: string; what: string; minutes: number }
const KEY = 'ledger-cardio';
const read = (): Log[] => { try { return JSON.parse(synced.getItem(KEY) ?? '[]'); } catch { return []; } };

/** Optional cardio: never required, earns a little bonus XP. */
export default function CardioCard({ onDemo }: { onDemo: (k: string) => void }) {
  const [logs, setLogs] = useState<Log[]>(read);
  const [open, setOpen] = useState(false);
  const addXP = useStore((s) => s.addXP);
  const wk = new Set(weekDays(today()));
  const mins = logs.filter((l) => wk.has(l.date)).reduce((a, l) => a + l.minutes, 0);
  const add = (what: string, minutes: number) => {
    const id = uid(); const next = [...logs, { id, date: today(), what, minutes }];
    setLogs(next); try { synced.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    addXP({ date: today(), stat: 'body', amount: 12, reason: `Cardio: ${what}`, ref: `cardio:${id}` });
    setOpen(false);
  };
  return (
    <section className="card cardio gym-rise">
      <div className="cardio-head">
        <div><span className="label">Optional cardio</span><div className="gym-muted">{mins ? `${mins} min this week` : 'Not required. Add it when you feel like it.'}</div></div>
        <button className="gym-btn gym-btn-ghost gym-btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Close' : 'Add cardio'}</button>
      </div>
      {open && (
        <ul className="cardio-list">
          {CARDIO.map((c) => (
            <li key={c.id}>
              <DemoThumb k={c.demo} onOpen={onDemo} size={44} />
              <div className="cardio-name">{c.name}<span className="mob-dose mono">{c.minutes} min</span></div>
              <button className="gym-btn gym-btn-sm" onClick={() => add(c.name, c.minutes)}>Log</button>
            </li>
          ))}
          <li className="cardio-note">Best after lifting or on mobility days. Build up slowly, no more than about 10% more a week. Skip it when you feel run down.</li>
        </ul>
      )}
    </section>
  );
}
