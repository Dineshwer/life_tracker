import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { SectionHeader } from '../../components/ui';
import LineChart from './LineChart';
import { prBoard, seriesFor, bodyWeightSeries, num, shortDate, unitSuffix, norm } from './lib';

export default function ProgressTab() {
  const workouts = useStore((s) => s.workouts);
  const body = useStore((s) => s.body);
  const board = useMemo(() => prBoard(workouts), [workouts]);
  const [key, setKey] = useState('');
  const row = board.find((b) => `${norm(b.exercise)}|${b.unit}` === key) ?? board[0];
  const data = row ? seriesFor(workouts, row.exercise, row.unit) : [];
  const bw = bodyWeightSeries(body);

  return (
    <div>
      <SectionHeader label="Personal records" />
      {board.length === 0 ? <div className="gym-empty">Log a few sets and your bests will gather here.</div> : (
        <div className="gym-prs">
          {board.map((b, i) => (
            <button key={`${b.exercise}|${b.unit}`} onClick={() => setKey(`${norm(b.exercise)}|${b.unit}`)} className={`card gym-pr-card gym-rise ${row === b ? 'sel' : ''}`} style={{ ['--d' as string]: `${i * 40}ms` }}>
              <span className="label gym-pr-name">{b.exercise}</span>
              <span className="display gym-pr-num">{num(b.value)}<span className="gym-pr-u">{unitSuffix(b.unit)}</span></span>
              <span className="gym-pr-meta">{b.unit === 'kg' ? `× ${b.reps} reps · ` : ''}{shortDate(b.date)}</span>
            </button>
          ))}
        </div>
      )}

      <SectionHeader label="Best set per session" />
      {row && (
        <>
          <select className="gym-select gym-pick" value={`${norm(row.exercise)}|${row.unit}`} onChange={(e) => setKey(e.target.value)} aria-label="Exercise">
            {board.map((b) => <option key={`${norm(b.exercise)}|${b.unit}`} value={`${norm(b.exercise)}|${b.unit}`}>{b.exercise} ({unitSuffix(b.unit)})</option>)}
          </select>
          <div className="card gym-chart-card"><LineChart id="ex" data={data} unit={unitSuffix(row.unit)} decimals={row.unit === 'kg' ? 1 : 0} /></div>
        </>
      )}
      {!row && <div className="gym-empty">No exercise to chart yet.</div>}

      <SectionHeader label="Body weight" />
      <div className="card gym-chart-card"><LineChart id="bw" data={bw} unit="kg" decimals={1} /></div>
    </div>
  );
}
