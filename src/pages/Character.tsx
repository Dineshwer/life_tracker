import { lazy, Suspense } from 'react';
import { useStore } from '../store';
import { SkinEmblem } from '../components/emblems';
import { useEmblemData } from '../components/emblems/useEmblemData';
import { BAND_GEAR, BODY_UNLOCKS, DISC_TIERS, DISC_UNLOCKS, MIND_TIERS, MIND_UNLOCKS, SKILL_TIERS, SKILL_UNLOCKS, STREAK_TIERS, STREAK_UNLOCKS, tierOf } from '../components/avatar/tiers';
import { Bar, Page, SectionHeader } from '../components/ui';
import { STATS, STAT_LABEL, levelFromXP, overallXP, sumByStat } from '../lib/xp';
import { addDays, fromISO, today } from '../lib/dates';
import './character/character.css';

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

import { TITLES, titleFor } from '../lib/titles';

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

const Avatar3D = lazy(() => import('../components/avatar/Avatar3D'));

/** first level of the band after `band`, from lib/titles */
const BAND_STARTS = TITLES.map((t) => t[0]);
const away = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} away`;

interface Unlock { key: string; label: string; level: string; text: string; color: string }

function nextUnlock(d: ReturnType<typeof useEmblemData>, lv: { mind: number; skill: number; disc: number }): string | null {
  const cands: { gap: number; text: string }[] = [];
  const tiered = (name: string, v: number, tiers: number[], texts: string[]) => {
    const k = tierOf(v, tiers);
    if (k < tiers.length) cands.push({ gap: tiers[k] - v, text: `${name} level ${tiers[k]}: ${texts[k + 1].replace(/^./, (c) => c.toLowerCase())} (${away(tiers[k] - v, 'level')})` });
  };
  tiered('Mind', lv.mind, MIND_TIERS, MIND_UNLOCKS);
  tiered('Skill', lv.skill, SKILL_TIERS, SKILL_UNLOCKS);
  tiered('Discipline', lv.disc, DISC_TIERS, DISC_UNLOCKS);
  const sk = tierOf(d.streak, STREAK_TIERS);
  if (sk < STREAK_TIERS.length) cands.push({ gap: STREAK_TIERS[sk] - d.streak, text: `${STREAK_TIERS[sk]}-day streak: ${STREAK_UNLOCKS[sk + 1].replace(/^./, (c) => c.toLowerCase())} (${away(STREAK_TIERS[sk] - d.streak, 'day')})` });
  if (d.band < 5 && BAND_STARTS[d.band] !== undefined) {
    const g = BAND_STARTS[d.band] - d.level;
    if (g > 0) cands.push({ gap: g, text: `Overall level ${BAND_STARTS[d.band]}: ${BAND_GEAR[d.band].replace(/^./, (c) => c.toLowerCase())} (${away(g, 'level')})` });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.gap - b.gap);
  return cands[0].text;
}

export default function Character() {
  const ed = useEmblemData();
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

  const [, title, line] = titleFor(ed.level);
  const net = series.reduce((a, b) => a + b, 0);

  const sl = (st: 'body' | 'mind' | 'skill' | 'discipline') => ed.stats[st].level;
  const unlocks: Unlock[] = [
    { key: 'outfit', label: 'Outfit', level: `Lv ${ed.level}`, text: BAND_GEAR[ed.band - 1], color: 'var(--accent)' },
    { key: 'body', label: 'Body', level: `Lv ${sl('body')}`, text: BODY_UNLOCKS(sl('body')), color: 'var(--body)' },
    { key: 'mind', label: 'Mind', level: `Lv ${sl('mind')}`, text: MIND_UNLOCKS[tierOf(sl('mind'), MIND_TIERS)], color: 'var(--mind)' },
    { key: 'skill', label: 'Skill', level: `Lv ${sl('skill')}`, text: SKILL_UNLOCKS[tierOf(sl('skill'), SKILL_TIERS)], color: 'var(--skill)' },
    { key: 'disc', label: 'Discipline', level: `Lv ${sl('discipline')}`, text: DISC_UNLOCKS[tierOf(sl('discipline'), DISC_TIERS)], color: 'var(--discipline)' },
    { key: 'streak', label: 'Streak', level: `${ed.streak} d`, text: STREAK_UNLOCKS[tierOf(ed.streak, STREAK_TIERS)], color: 'var(--accent-2)' },
  ];
  const next = nextUnlock(ed, { mind: sl('mind'), skill: sl('skill'), disc: sl('discipline') });

  return (
    <Page title="Character" kicker={`${total.toLocaleString()} total XP`}>
      <section className="card ch-hero rise" style={{ ['--i' as string]: 0 }}>
        <div className="ch-tree">
          <Suspense fallback={<div className="ch-emblem"><SkinEmblem /></div>}><Avatar3D className="ch-avatar" /></Suspense>
        </div>
        <div className="ch-id">
          <div className="label">{title} &middot; band {ed.band} of 5</div>
          <h2 className="display ch-title">{title}</h2>
          <p className="ch-line">{line}</p>
          <div className="ch-lvl">
            <div className="ch-next">
              <div className="display ch-xp">{Math.round(o.into)}<small> / {o.need}</small></div>
              <div className="label">XP to level {o.level + 1}</div>
              <Bar pct={o.pct} height={5} />
            </div>
          </div>
          <div className="ch-unlocks">
            <h3 className="label ch-un-h">What you have unlocked</h3>
            <ul className="ch-un-list">
              {unlocks.map((u) => (
                <li key={u.key} style={{ ['--c' as string]: u.color }}>
                  <span className="ch-un-k"><i className="ch-dot" />{u.label}<small>{u.level}</small></span>
                  <span className="ch-un-v">{u.text}</span>
                </li>
              ))}
            </ul>
            {next && <p className="ch-un-next"><span className="label">Next unlock</span> {next}</p>}
          </div>
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
