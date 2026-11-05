import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Habit, Stat } from '../types';
import { Button, Page, SectionHeader } from '../components/ui';
import { IconFlame, IconPlus } from '../components/icons';
import { STATS, STAT_LABEL } from '../lib/xp';
import { addDays, today } from '../lib/dates';
import Heatmap from './habits/Heatmap';
import HabitSheet from './habits/HabitSheet';
import { cadenceText, isSched, logSet, streak, weekly } from './habits/stats';
import './habits/habits.css';

type Metric = 'streaks' | 'heatmap' | 'percentage';
const KEY = 'ledger-habit-view';
const ALL: Metric[] = ['streaks', 'heatmap', 'percentage'];
const loadView = (): Metric[] => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? ''); if (Array.isArray(v)) return v.filter((x) => ALL.includes(x)); } catch { /* ignore */ }
  return ALL;
};

export default function Habits() {
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.habitLogs);
  const upsert = useStore((s) => s.upsert);
  const [view, setView] = useState<Metric[]>(loadView);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [open, setOpen] = useState(false);

  const toggle = (m: Metric) => {
    const next = view.includes(m) ? view.filter((x) => x !== m) : ALL.filter((x) => x === m || view.includes(x));
    setView(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const show = (m: Metric) => view.includes(m);

  const active = habits.filter((h) => !h.archived);
  const archived = habits.filter((h) => h.archived);

  const rows = useMemo(() => active.map((h) => {
    const m = logSet(logs, h.id);
    return { h, m, st: streak(h, m), wk: weekly(h, m) };
  }), [active, logs]);

  const overall = rows.length ? rows.reduce((a, r) => a + r.wk, 0) / rows.length : 0;
  const best = rows.reduce((a, r) => (r.st.unit === 'd' ? Math.max(a, r.st.n) : a), 0);
  const holding = rows.filter((r) => r.st.n > 0).length;

  const aggLevel = (d: string) => {
    const sched = active.filter((h) => isSched(h, d) || (h.cadence.type === 'weekly' && logSet(logs, h.id).has(d)));
    if (!sched.length) return -1;
    const done = sched.filter((h) => logSet(logs, h.id).has(d)).length;
    return done === 0 ? 0 : Math.max(1, Math.ceil((done / sched.length) * 4));
  };

  const edit = (h: Habit | null) => { setEditing(h); setOpen(true); };

  const ringPct = overall;
  const R = 62, CIRC = 2 * Math.PI * R;
  const t0 = today();
  const week = Array.from({ length: 7 }, (_, i) => addDays(t0, i - 6));
  let n = 0;

  return (
    <Page title="Habits" kicker={`${active.length} active`} actions={<Button variant="ghost" onClick={() => edit(null)}><IconPlus size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Add</Button>}>
      <section className="card hb-hero rise" style={{ ['--i' as string]: 0 }}>
        <div className="hb-score">
          <div className="hb-ringw" role="img" aria-label={`Weekly score ${Math.round(overall * 100)} percent`}>
            <svg viewBox="0 0 150 150">
              <circle cx="75" cy="75" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
              {show('percentage') && <circle className="hb-arc" cx="75" cy="75" r={R} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - ringPct)} transform="rotate(-90 75 75)" />}
            </svg>
            <div className="c">{show('percentage') ? <div className="display hb-big">{Math.round(overall * 100)}<small>%</small></div> : <div className="display hb-big" style={{ color: 'var(--faint)' }}>&mdash;</div>}</div>
          </div>
          <div>
            <div className="label">Weekly score</div>
            <h2 className="display hb-lede">{overall >= 0.8 ? 'Locked in.' : overall >= 0.5 ? 'Holding steady.' : 'Room to grow.'}</h2>
            <div className="hb-metrics" role="group" aria-label="Metrics shown">
              {ALL.map((m) => <button key={m} className="chip" aria-pressed={show(m)} onClick={() => toggle(m)}>{m}</button>)}
            </div>
          </div>
        </div>
        <div className="hb-aside">
          {show('streaks') && (
            <div className="hb-best">
              <div><div className="label">Longest running</div><div className="display n">{best}<span className="label"> days</span></div></div>
              <div><div className="label">Holding streaks</div><div className="display n">{holding}<span className="label"> of {rows.length}</span></div></div>
            </div>
          )}
          {show('heatmap') && <Heatmap color="var(--accent)" level={aggLevel} label="Overall 12-week completion" />}
        </div>
      </section>

      {STATS.map((s: Stat) => {
        const g = rows.filter((r) => r.h.stat === s);
        if (!g.length) return null;
        const color = `var(--${s})`;
        return (
          <section className="hb-group" key={s}>
            <SectionHeader label={STAT_LABEL[s]} right={<><i className="hb-dot" style={{ background: color }} />{g.length}</>} />
            <div className="hb-list">
            {g.map(({ h, m, st, wk }) => (
              <div className="card hb-row rise" key={h.id} style={{ ['--c' as string]: color, ['--i' as string]: 1 + Math.min(n++, 10) }}>
                <div className="hb-id">
                  <button className="name" onClick={() => edit(h)}>{h.name}</button>
                  <div className="hb-cad">{cadenceText(h)} &middot; {h.xp} XP</div>
                </div>
                {show('streaks') && (
                  <div className={`hb-streak${st.n ? ' on' : ''}`} title="Current streak">
                    <IconFlame size={18} />
                    <span className="display v">{st.n}</span><i>{st.unit}</i>
                  </div>
                )}
                <div className="hb-week" aria-label="Last 7 days">
                  {week.map((d) => {
                    const l = m.get(d);
                    const st2 = l ? (l.level === 'full' ? 'full' : 'min') : isSched(h, d) ? 'miss' : 'off';
                    return <span key={d} className={`hb-d hb-d-${st2}${d === t0 ? ' hb-now' : ''}`} title={d} />;
                  })}
                </div>
                {show('percentage') && <div className="hb-pct"><span className="display v">{Math.round(wk * 100)}</span><i>%</i></div>}
                {show('heatmap') && (
                  <Heatmap color={color} label={`${h.name} 12-week history`} level={(d) => {
                    const l = m.get(d); if (l) return l.level === 'full' ? 4 : 2;
                    if (h.cadence.type === 'weekly') return d < addDays(today(), 0) ? 0 : -1;
                    return isSched(h, d) ? (d < today() ? 0 : -1) : -1;
                  }} />
                )}
              </div>
            ))}
            </div>
          </section>
        );
      })}
      {!active.length && <p className="hb-empty">No habits yet. Add one to begin.</p>}

      {archived.length > 0 && (
        <section className="hb-arch">
          <SectionHeader label="Archived" right={archived.length} />
          <div className="hb-list">
          {archived.map((h) => <div className="card hb-arow" key={h.id}><div><button className="name" onClick={() => edit(h)}>{h.name}</button><div className="hb-cad">{STAT_LABEL[h.stat]} &middot; {cadenceText(h)}</div></div></div>)}
          </div>
        </section>
      )}

      <HabitSheet habit={editing} open={open} onClose={() => setOpen(false)} onSave={(h) => upsert('habits', h)} />
    </Page>
  );
}
