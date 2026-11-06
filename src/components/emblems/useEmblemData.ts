import { useMemo } from 'react';
import { useStore } from '../../store';
import { STATS, levelFromXP, overallXP, sumByStat } from '../../lib/xp';
import { bandFor, titleFor } from '../../lib/titles';
import { currentStreak } from '../../lib/streak';
import { today } from '../../lib/dates';
import type { EmblemData } from './types';

const QS = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export function useEmblemData(): EmblemData {
  const xp = useStore((s) => s.xp);
  const habitLogs = useStore((s) => s.habitLogs);
  return useMemo(() => {
    const byStat = sumByStat(xp);
    const o = levelFromXP(overallXP(xp));
    const stats = Object.fromEntries(STATS.map((st) => { const l = levelFromXP(byStat[st]); return [st, { level: l.level, pct: l.pct, into: l.into, need: l.need }]; })) as EmblemData['stats'];
    let data: EmblemData = {
      level: o.level, title: titleFor(o.level)[1], band: bandFor(o.level), pct: o.pct, into: o.into, need: o.need, total: o.total,
      stats, xpToday: xp.filter((e) => e.date === today()).reduce((a, e) => a + e.amount, 0), streak: currentStreak(habitLogs),
    };
    // QA only: ?lv=12 forces a high level so double-digit numerals and full trees can be judged
    const forced = Number(QS.get('lv'));
    if (forced >= 1) {
      const lv = Math.round(forced);
      data = { ...data, level: lv, title: titleFor(lv)[1], band: bandFor(lv), pct: 0.62, into: 124, need: 200, total: lv * 400,
        stats: Object.fromEntries(STATS.map((st, i) => [st, { level: Math.max(1, lv - (i % 3)), pct: [0.7, 0.4, 0.85, 0.55][i], into: 50, need: 100 }])) as EmblemData['stats'], streak: 12 };
    }
    return data;
  }, [xp, habitLogs]);
}
