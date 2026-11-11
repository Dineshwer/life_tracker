import { useState } from 'react';
import { Button, Page, SectionHeader } from '../components/ui';
import { useStore } from '../store';
import { ONE, ONE_BY_ID, daysBetween, lastNDays, levelOf, type Entry } from '../lib/oneExercise';

import Heatmap from './habits/Heatmap';
import LogSheet from './one/LogSheet';
import { useOne } from './one/useOne';
import type { OneId } from '../types';
import './one/one.css';

const COLOR: Record<string, string> = { push: 'var(--body)', pull: 'var(--skill)', legs: 'var(--discipline)' };
const ago = (n: number | null) => (n === null ? 'never' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

export default function OneExercise() {
  const { t, entries, stats, ranked, top, doneToday } = useOne();
  const oneLogs = useStore((s) => s.oneLogs);
  const remove = useStore((s) => s.removeOneLog);
  const [open, setOpen] = useState<OneId | null>(null);
  const days = lastNDays(t, 7);
  const dayLabel = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short' });
  const pick = ONE_BY_ID[top.id];
  const rank = new Map(ranked.map((r, i) => [r.id, i + 1]));
  const recent = [...oneLogs].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  const total = stats.reduce((a, s) => a + s.sessions, 0);

  return (
    <Page title="The one" kicker="Daily minimum · 1-10 method">
      <section className="card one-hero rise">
        <div>
          <div className="label">{doneToday.length ? 'Done today. Next up' : 'Suggested for today'}</div>
          <div className="display one-name big">{pick.name}</div>
          <div className="one-why">{top.reason}. Easy dose: {pick.dose}.</div>
        </div>
        <Button onClick={() => setOpen(pick.id)}>{doneToday.length ? 'Log another' : 'Log it'}</Button>
      </section>
      <p className="one-note">Gym sessions count here automatically. Keep this easy (about 5–6 out of 10) on non-workout days. Suggestions favour what you have not done lately, what is behind your 30-day average, and muscles that are rested.</p>

      <SectionHeader label="Last 7 days" right={`${total} sessions`} />
      <div className="card one-map rise" style={{ ['--i' as string]: 1 }}>
        <div className="one-map-head"><span />{days.map((d) => <span key={d} className={`label${d === t ? ' now' : ''}`}>{dayLabel(d)}</span>)}</div>
        {ONE.map((o) => {
          const s = stats.find((x) => x.def.id === o.id)!;
          return (
            <div className="one-map-row" key={o.id}>
              <button className="one-map-name" onClick={() => setOpen(o.id)}>{o.name}</button>
              {s.week.map((reps, i) => (
                <span key={days[i]} className={`one-cell l${levelOf(reps)}`} style={{ ['--c' as string]: COLOR[o.group] }} title={reps ? `${reps} reps` : 'none'}>{reps || ''}</span>
              ))}
            </div>
          );
        })}
      </div>

      <SectionHeader label="All eight" right="tap to log" />
      <ul className="one-list rise" style={{ ['--i' as string]: 2 }}>
        {stats.map((s) => {
          const lvl = (d: string) => levelOf(entries.filter((e: Entry) => e.ex === s.def.id && e.date === d).reduce((a, e) => a + e.reps, 0));
          const isTop = s.def.id === top.id;
          return (
            <li key={s.def.id} className={`card one-row${isTop ? ' top' : ''}`}>
              <div className="one-row-main">
                <div className="one-row-name"><i className="sdot" style={{ background: COLOR[s.def.group] }} />{s.def.name}{isTop && <span className="chip mono">suggested</span>}</div>
                <div className="one-row-sub">Last {ago(s.daysSince)} · {s.def.dose}</div>
                <div className="one-row-nums">
                  <span><b className="mono">{s.sessions}</b> sessions</span>
                  <span><b className="mono">{s.sets}</b> sets</span>
                  <span><b className="mono">{s.reps}</b> reps</span>
                  <span><b className="mono">{s.count30}</b> in 30 days</span>
                  <span>rank {rank.get(s.def.id)} of 8</span>
                </div>
              </div>
              <Heatmap color={COLOR[s.def.group]} level={lvl} label={`${s.def.name}, last 12 weeks`} />
              <Button variant="ghost" onClick={() => setOpen(s.def.id)}>Log</Button>
            </li>
          );
        })}
      </ul>

      {recent.length > 0 && (<>
        <SectionHeader label="Recent logs" />
        <ul className="card one-recent">
          {recent.map((l) => (
            <li key={l.id}>
              <span>{ONE_BY_ID[l.exercise].name}</span>
              <span className="mono">{l.sets} × {l.reps}{l.effort ? ` · ${l.effort}/10` : ''}</span>
              <span className="label">{daysBetween(l.date, t) === 0 ? 'today' : `${daysBetween(l.date, t)}d ago`}</span>
              <Button variant="text" onClick={() => remove(l.id)} aria-label="Remove this log">Remove</Button>
            </li>
          ))}
        </ul>
      </>)}
      <LogSheet open={open !== null} exercise={open} onClose={() => setOpen(null)} />
    </Page>
  );
}
