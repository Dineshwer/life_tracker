import { useStore } from '../store';
import LevelMeter from '../components/levelmeter/LevelMeter';
import Sapling from '../components/Sapling';
import { Bar, Page, SectionHeader } from '../components/ui';
import { STATS, STAT_LABEL, levelFromXP, overallXP, sumByStat } from '../lib/xp';
import { addDays, fromISO, today } from '../lib/dates';
import './character/character.css';

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

import { TITLES, titleFor } from '../lib/titles';

function LevelRing({ pct, level }: { pct: number; level: number }) {
  const r = 86, c = 2 * Math.PI * r;
  return (
    <div className="ch-ring" role="img" aria-label={`Overall level ${level}`}>
      <svg viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
        <circle className="ch-arc" cx="100" cy="100" r={r} fill="none" stroke="var(--accent-2)" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 100 100)" />
      </svg>
      <div className="c"><div className="label">Level</div><div className="display lv">{level}</div></div>
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  const W = 320, H = 72, p = 4;
  const max = Math.max(1, ...values.map(Math.abs));
  const x = (i: number) => p + (i * (W - 2 * p)) / (values.length - 1);
  const y = (v: number) => H / 2 - (v / max) * (H / 2 - p);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="ch-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net XP, last 14 days">
      <line x1={p} x2={W - p} y1={H / 2} y2={H / 2} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="2 3" />
      <path d={`${d} L${x(values.length - 1).toFixed(1)} ${H / 2} L${x(0).toFixed(1)} ${H / 2} Z`} fill="var(--accent)" opacity=".1" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 4px var(--accent))' }} />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 2.5 : 1.2} fill={v < 0 ? 'var(--danger)' : 'var(--accent)'} />)}
    </svg>
  );
}

export default function Character() {
  const xp = useStore((s) => s.xp);
  const total = overallXP(xp);
  const o = levelFromXP(total);
  const by = sumByStat(xp);

  const t = today();
  const days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const series = days.map((d) => xp.filter((e) => e.date === d).reduce((a, e) => a + e.amount, 0));
  const recent = [...xp].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 25);
  const recentIdx = new Map(xp.map((e, i) => [e.id, i]));
  recent.sort((a, b) => (a.date === b.date ? (recentIdx.get(b.id) ?? 0) - (recentIdx.get(a.id) ?? 0) : 0));

  const [, title, line] = titleFor(o.level);
  const levels = { body: levelFromXP(by.body).level, mind: levelFromXP(by.mind).level, skill: levelFromXP(by.skill).level, discipline: levelFromXP(by.discipline).level };
  const net = series.reduce((a, b) => a + b, 0);

  return (
    <Page title="Character" kicker={`${total.toLocaleString()} total XP`}>
      <section className="card ch-hero rise" style={{ ['--i' as string]: 0 }}>
        <div className="ch-tree">
          <div className="ch-halo" aria-hidden />
          <div className="ch-sway"><Sapling levels={levels} overall={o.level} size={300} /></div>
        </div>
        <div className="ch-id">
          <div className="label">{title} &middot; band {Math.max(1, TITLES.findIndex((t) => t[1] === title) + 1)} of 5</div>
          <h2 className="display ch-title">{title}</h2>
          <p className="ch-line">{line}</p>
          <div className="ch-lvl">
            <LevelRing pct={o.pct} level={o.level} />
            <div className="ch-next">
              <div className="display ch-xp">{Math.round(o.into)}<small> / {o.need}</small></div>
              <div className="label">XP to level {o.level + 1}</div>
            </div>
          </div>
          <LevelMeter />
        </div>
      </section>

      <section className="ch-stats">
        {STATS.map((s, i) => {
          const li = levelFromXP(by[s]); const color = `var(--${s})`;
          return (
            <div className="card ch-stat rise" key={s} style={{ ['--c' as string]: color, ['--i' as string]: i + 1 }}>
              <div className="label ch-nm"><i className="ch-dot" />{STAT_LABEL[s]}</div>
              <div className="display ch-lv">{li.level}</div>
              <Bar pct={li.pct} color={color} height={5} />
              <div className="ch-nums">{Math.round(li.into)} / {li.need} XP</div>
            </div>
          );
        })}
      </section>

      <div className="ch-cols">
        <div className="rise" style={{ ['--i' as string]: 5 }}>
          <SectionHeader label="Recent XP" right={`last ${recent.length}`} />
          {recent.length ? (
            <ul className="ch-led">
              {recent.map((e) => (
                <li key={e.id} className={e.amount < 0 ? 'neg' : ''} style={{ ['--c' as string]: `var(--${e.stat})` }}>
                  <span className="d">{fromISO(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                  <span className="r">{e.reason}<small>{STAT_LABEL[e.stat]}</small></span>
                  <span className="a">{fmt(e.amount)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="ch-empty">No XP yet. Complete a habit or task to begin the ledger.</p>}
        </div>
        <div className="rise" style={{ ['--i' as string]: 6 }}>
          <SectionHeader label="14 days" />
          <div className="card ch-sparkcard">
            <Spark values={series} />
            <div className="ch-spark-meta label"><span>{fromISO(days[0]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span><span style={{ color: net < 0 ? 'var(--danger)' : 'var(--accent-2)' }}>Net {fmt(net)}</span></div>
          </div>
          <SectionHeader label="The rules" />
          <div className="ch-note display">
            <p>Every habit and task earns XP in the stat it belongs to. Minimum versions earn half.</p>
            <p>A missed scheduled day costs XP. Stats can fall back to zero, but a level, once reached, never drops.</p>
          </div>
        </div>
      </div>
    </Page>
  );
}
