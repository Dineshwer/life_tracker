import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { Bar, Ring, SectionHeader } from '../components/ui';
import { fmtTime, isWeekend, minutes, today as todayISO } from '../lib/dates';
import { STATS, STAT_LABEL, levelFromXP, sumByStat } from '../lib/xp';
import HeroEmblem from '../components/emblems';
import RejectionMeter from './rejections/RejectionMeter';
import { REJECTION_GOAL } from '../lib/rejections';
import { DayLine } from './today/DayLine';
import { RingTap } from './today/RingTap';
import { SKILL_OF_DAY, blocksForDay, dueToday, fmtHours, freeMinutesLeft, statVar } from './today/helpers';
import './today/today.css';

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export default function Today() {
  const s = useStore();
  const { habits, habitLogs: logs, tasks, blocks, xp, wake, settings, logHabit, toggleTask, tapWake } = s;
  const d = todayISO();
  const [nowMin, setNow] = useState(nowMinutes);
  const rejTotal = useStore((st) => st.rejections.length);
  const rejToday = useStore((st) => st.rejections.filter((r) => r.date === d).length);
  useEffect(() => { const t = window.setInterval(() => setNow(nowMinutes()), 60000); return () => window.clearInterval(t); }, []);

  const hr = Math.floor(nowMin / 60);
  const greet = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const target = isWeekend(d) && settings.weekendWake ? settings.weekendWake : settings.wakeTime;
  const wakeLog = wake.find((w) => w.date === d);
  const late = wakeLog ? minutes(wakeLog.time) - minutes(target) : 0;
  const onTime = late <= 15;

  const due = useMemo(() => dueToday(habits, logs, d), [habits, logs, d]);
  const todays = useMemo(() => tasks.filter((t) => !t.parentId && (t.date === d || t.horizon === 'today')), [tasks, d]);
  const free = freeMinutesLeft(blocksForDay(blocks, d), target, nowMin);

  const todayXP = xp.filter((e) => e.date === d).reduce((a, e) => a + e.amount, 0);
  const byStat = sumByStat(xp);
  const skill = SKILL_OF_DAY[new Date().getDay()];

  const quick = [
    ...due.filter((x) => x.level === 'none').map((x) => ({ key: x.h.id, title: x.h.name, cost: x.h.xp, color: statVar(x.h.stat), run: () => logHabit(x.h.id, d, 'min'), hint: x.h.minimum })),
    ...todays.filter((t) => !t.done && t.effort === 1).map((t) => ({ key: t.id, title: t.title, cost: 10, color: statVar(t.stat), run: () => toggleTask(t.id), hint: undefined as string | undefined })),
  ].sort((a, b) => a.cost - b.cost).slice(0, 3);

  const habitsDone = due.filter((x) => x.level !== 'none').length;
  const dayPct = due.length ? habitsDone / due.length : 0;
  const now = new Date();
  const weekday = now.toLocaleDateString('en-IN', { weekday: 'long' });
  const dateRest = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  const R = 34, C = 2 * Math.PI * R;
  let n = 0;
  const rise = () => ({ ['--i' as string]: n++ });

  return (
    <div className="today">
      <section className="card hero rise" style={rise()}>
        <div className="hero-text">
          <div className="t-greet">{greet}, {settings.name}.</div>
          <h1 className="display t-date"><em>{weekday}</em><span>{dateRest}</span></h1>
          <p className="t-skill-line"><span className="label">Skill of the day</span>{skill.line}</p>
          <div className="wake">
            {wakeLog ? (
              <div className="wake-done">
                <span className="display">{fmtTime(wakeLog.time)}</span>
                <span className={`label ${onTime ? 'wake-ok' : 'wake-late'}`}>{onTime ? 'Up on time' : `Up ${late} min late`}</span>
              </div>
            ) : (
              <button className="btn btn-solid wake-btn" onClick={tapWake}><span className="display">I'm up</span><span className="wake-tap">Tap to log</span></button>
            )}
            <div className="wake-note">Target {fmtTime(target)}{wakeLog ? '' : ' · logged with the time you tap'}</div>
          </div>
        </div>
        <HeroEmblem />
        <div className="hero-foot">
          <div className="prog" role="img" aria-label={`${habitsDone} of ${due.length} habits touched`}>
            <svg viewBox="0 0 80 80" width="76" height="76">
              <circle cx="40" cy="40" r={R} className="prog-track" />
              <circle cx="40" cy="40" r={R} className="prog-fill" strokeDasharray={C} strokeDashoffset={C * (1 - dayPct)} transform="rotate(-90 40 40)" />
            </svg>
            <span className="display prog-n">{habitsDone}<small>/{due.length}</small></span>
          </div>
          <div><div className="label">Habits touched</div><div className="cap-sub">{due.length ? `${Math.round(dayPct * 100)}% of today's due` : 'Nothing due today'}</div></div>
          <div className="hero-sep" />
          <div><div className="label">Free time left</div><div className="cap-val display">{fmtHours(free)}</div><div className="cap-sub">after job and agency</div></div>
        </div>
      </section>

      <div className="t-grid">
        <div>
          <SectionHeader label="Day line" />
          <DayLine nowMin={nowMin} rise={() => rise()} />

          <SectionHeader label="Habits due" right={due.length ? `${habitsDone} of ${due.length}` : undefined} />
          {due.length === 0 ? <p className="t-empty">Nothing is due. Rest is part of the plan.</p> : (
            <ul className="hl card rise" style={rise()}>
              {due.map(({ h, level, week }) => (
                <li key={h.id} className={level === 'full' ? 'is-done' : ''} style={{ ['--c' as string]: statVar(h.stat) }}>
                  <RingTap state={level} label={`Log ${h.name}`} color={statVar(h.stat)}
                    onFull={() => logHabit(h.id, d, 'full')} onMin={() => logHabit(h.id, d, 'min')} onClear={() => logHabit(h.id, d, null)} />
                  <div className="hl-main">
                    <div className={`hl-name${level === 'full' ? ' done' : ''}`}><i className="sdot" />{h.name}</div>
                    <div className="hl-sub">
                      {level === 'min' ? `Minimum: ${h.minimum ?? 'done'}` : h.cadence.type === 'weekly' && week !== undefined ? `${week} of ${h.cadence.perWeek} this week` : h.minimum ? `Minimum: ${h.minimum}` : STAT_LABEL[h.stat]}
                      {level !== 'min' && h.cadence.type === 'weekly' && week !== undefined && h.minimum ? ` · min: ${h.minimum}` : ''}
                    </div>
                  </div>
                  {level === 'none' && <button className="minbtn" onClick={() => logHabit(h.id, d, 'min')}>min</button>}
                  <span className="chip mono">+{h.xp}</span>
                </li>
              ))}
            </ul>
          )}

          <SectionHeader label="Quick wins" right="low energy" />
          {quick.length === 0 ? <p className="t-empty">Nothing small is left. You have done the easy part.</p> : (
            <div className="qw rise" style={rise()}>
              {quick.map((q) => (
                <button className="qw-item card" key={q.key} onClick={q.run} style={{ ['--c' as string]: q.color }} aria-label={`Complete ${q.title}`}>
                  <span className="qw-top"><i className="sdot" /><span className="chip mono">+{q.cost}</span></span>
                  <span className="qw-t">{q.title}</span>
                  {q.hint && <span className="hl-sub">{q.hint}</span>}
                </button>
              ))}
            </div>
          )}

          <SectionHeader label="Tasks" right={todays.length ? `${todays.filter((t) => t.done).length} of ${todays.length}` : undefined} />
          {todays.length === 0 ? <p className="t-empty">No tasks for today. Add one from Tasks when something matters.</p> : (
            <ul className="hl card rise" style={rise()}>
              {todays.map((t) => {
                const subs = tasks.filter((x) => x.parentId === t.id);
                return (
                  <li key={t.id} className={t.done ? 'is-done' : ''} style={{ ['--c' as string]: statVar(t.stat) }}>
                    <Ring state={t.done ? 'full' : 'none'} color={statVar(t.stat)} label={`Toggle ${t.title}`} onClick={() => toggleTask(t.id)} />
                    <div className="hl-main">
                      <div className={`hl-name${t.done ? ' done' : ''}`}><i className="sdot" />{t.title}</div>
                      <div className="hl-sub">{t.context}{subs.length ? ` · ${subs.filter((x) => x.done).length} of ${subs.length} subtasks` : ''}</div>
                    </div>
                    <span className="chip mono">+{[0, 10, 20, 40][t.effort]}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="t-rail">
          <SectionHeader label="XP today" />
          <div className="card rail-block rise" style={rise()}>
            <div className="xp-big display">{todayXP >= 0 ? '+' : ''}{todayXP}<small>xp</small></div>
            <Bar pct={todayXP / 150} color="var(--accent-2)" height={4} />
            <div className="hl-sub" style={{ marginTop: 10 }}>{todayXP > 0 ? 'Earned so far today.' : 'Nothing earned yet. One small thing is enough to start.'}</div>
            <div className="lvs">
              {STATS.map((st) => {
                const l = levelFromXP(byStat[st]);
                return (
                  <div className="lv" key={st}>
                    <div className="lv-top"><span className="label" style={{ color: statVar(st) }}>{STAT_LABEL[st]}</span><span className="lv-n display">{l.level}</span></div>
                    <Bar pct={l.pct} color={statVar(st)} height={3} />
                  </div>
                );
              })}
            </div>
          </div>

          <SectionHeader label="The 1,000" />
          <Link to="/rejections" className="card rail-block rise rj-widget" style={rise()} aria-label="Open the rejections tracker">
            <div className="rj-w-top"><span className="xp-big display">{rejTotal}</span><span className="rj-w-of">/ {REJECTION_GOAL.toLocaleString()}</span></div>
            <RejectionMeter total={rejTotal} compact />
            <div className="hl-sub" style={{ marginTop: 12 }}>{rejToday > 0 ? `${rejToday} logged today. Keep going.` : 'None logged today. Log one →'}</div>
          </Link>
        </aside>
      </div>
    </div>
  );
}
