import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, SectionHeader } from '../../components/ui';
import { ONE_BY_ID, lastNDays } from '../../lib/oneExercise';
import LogSheet from './LogSheet';
import { useOne } from './useOne';
import './one.css';

/** Compact "The One" panel for the Today screen. */
export default function OnePanel({ style }: { style?: React.CSSProperties }) {
  const { t, entries, top, doneToday } = useOne();
  const [open, setOpen] = useState<string | null>(null);
  const days = lastNDays(t, 7);
  const done = doneToday.length > 0;
  const pick = ONE_BY_ID[top.id];
  const letters = days.map((d) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'narrow' }));
  return (
    <>
      <SectionHeader label="The one" right={<Link to="/one" className="one-link">All 8 →</Link>} />
      <div className="card one-panel rise" style={style}>
        <div className="one-panel-main">
          {done ? (
            <>
              <div className="label one-ok">Done today</div>
              <div className="display one-name">{doneToday.map((id) => ONE_BY_ID[id].name).join(' + ')}</div>
              <div className="one-why">Next up: {pick.name}. {top.reason}.</div>
            </>
          ) : (
            <>
              <div className="label">Suggested for today</div>
              <div className="display one-name">{pick.name}</div>
              <div className="one-why">{top.reason}. {pick.dose}.</div>
            </>
          )}
          <div className="one-actions">
            <Button onClick={() => setOpen(pick.id)}>{done ? 'Log another' : 'Log it'}</Button>
            <Link to="/one" className="btn btn-ghost">Pick a different one</Link>
          </div>
        </div>
        <div className="one-strip" role="img" aria-label="Days you kept the minimum in the last 7 days">
          {days.map((d, i) => {
            const hit = entries.some((e) => e.date === d);
            return <span key={d} className={`one-day${hit ? ' on' : ''}${d === t ? ' now' : ''}`}><i />{letters[i]}</span>;
          })}
        </div>
      </div>
      <LogSheet open={open !== null} exercise={open as never} onClose={() => setOpen(null)} />
    </>
  );
}
