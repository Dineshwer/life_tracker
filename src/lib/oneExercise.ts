import type { OneId, OneLog, Workout, ISODate } from '../types';
import { addDays, fromISO } from './dates';

export type Group = 'push' | 'pull' | 'legs';
export interface OneDef { id: OneId; name: string; group: Group; dose: string; match: RegExp }

/** The eight exercises of the 1-10 method. `match` links gym-session sets to them so workout days count automatically. */
export const ONE: OneDef[] = [
  { id: 'pullups', name: 'Pull-ups', group: 'pull', dose: '5 × 1–2, plus negatives', match: /pull[- ]?ups?|chin[- ]?ups?/i },
  { id: 'dips', name: 'Dips', group: 'push', dose: '4 × 6–8', match: /\bdips?\b/i },
  { id: 'pushups', name: 'Push-ups', group: 'push', dose: '5 × 8–10', match: /push[- ]?ups?/i },
  { id: 'rows', name: 'Rows', group: 'pull', dose: '4 × 8–12', match: /\brows?\b/i },
  { id: 'pikes', name: 'Pike push-ups', group: 'push', dose: '4 × 5–8', match: /pike/i },
  { id: 'squats', name: 'Squats', group: 'legs', dose: '4 × 8–10 (goblet)', match: /squat/i },
  { id: 'splits', name: 'Split squats', group: 'legs', dose: '3 × 8 each leg', match: /split squat|bulgarian/i },
  { id: 'rdls', name: 'RDLs', group: 'legs', dose: '4 × 8 (dumbbells)', match: /\brdl|romanian/i },
];
export const ONE_BY_ID = Object.fromEntries(ONE.map((o) => [o.id, o])) as Record<OneId, OneDef>;

/** Order matters: more specific names first, so "pike push-up" is not counted as a push-up. */
export function idForName(name: string): OneId | null {
  if (/pike/i.test(name)) return 'pikes';
  if (/split squat|bulgarian/i.test(name)) return 'splits';
  if (/pistol|jump/i.test(name)) return null;
  for (const o of ONE) if (o.match.test(name)) return o.id;
  return null;
}

export interface Entry { date: ISODate; ex: OneId; sets: number; reps: number; src: 'one' | 'gym'; logId?: string }

/** Everything that counts: manual logs plus matching sets from gym sessions (hold-type sets are skipped). */
export function entriesOf(oneLogs: OneLog[], workouts: Workout[]): Entry[] {
  const out: Entry[] = oneLogs.map((l) => ({ date: l.date, ex: l.exercise, sets: l.sets, reps: l.sets * l.reps, src: 'one', logId: l.id }));
  for (const w of workouts) {
    const by = new Map<OneId, { sets: number; reps: number }>();
    for (const s of w.sets) {
      if (s.unit === 'sec' || !(s.reps > 0)) continue;
      const id = idForName(s.exercise); if (!id) continue;
      const a = by.get(id) ?? { sets: 0, reps: 0 }; a.sets++; a.reps += s.reps; by.set(id, a);
    }
    for (const [ex, a] of by) out.push({ date: w.date, ex, sets: a.sets, reps: a.reps, src: 'gym' });
  }
  return out;
}

export interface ExStat {
  def: OneDef; sessions: number; sets: number; reps: number;
  last: ISODate | null; daysSince: number | null;
  /** last 7 days, oldest first; reps done that day (0 = none) */
  week: number[]; count30: number;
}

export const daysBetween = (a: ISODate, b: ISODate) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
export const lastNDays = (t: ISODate, n: number) => Array.from({ length: n }, (_, i) => addDays(t, i - (n - 1)));

export function statsFor(entries: Entry[], t: ISODate): ExStat[] {
  const days7 = lastNDays(t, 7);
  return ONE.map((def) => {
    const mine = entries.filter((e) => e.ex === def.id && e.date <= t);
    const dates = new Set(mine.map((e) => e.date));
    const last = mine.reduce<ISODate | null>((m, e) => (!m || e.date > m ? e.date : m), null);
    return {
      def, sessions: dates.size, sets: mine.reduce((a, e) => a + e.sets, 0), reps: mine.reduce((a, e) => a + e.reps, 0),
      last, daysSince: last ? daysBetween(last, t) : null,
      week: days7.map((d) => mine.filter((e) => e.date === d).reduce((a, e) => a + e.reps, 0)),
      count30: [...dates].filter((d) => daysBetween(d, t) < 30).length,
    };
  });
}

export interface Suggestion { id: OneId; score: number; reason: string }

/**
 * Score every exercise and rank them. Drivers (see the page copy):
 *  - time since last done (longer = higher; never done = highest)
 *  - frequency over the last 30 days vs the average of the eight
 *  - done in the last 3 days (pushed down)
 *  - muscle group worked yesterday (pushed down, so pulling is rested after a pull day, legs after a leg day)
 *  - day type from the plan: Wed is a hip day, Sun is a shoulder and spine day
 */
export function suggest(entries: Entry[], t: ISODate): Suggestion[] {
  const stats = statsFor(entries, t);
  const avg30 = stats.reduce((a, s) => a + s.count30, 0) / stats.length;
  const yesterday = addDays(t, -1);
  const yGroups = new Set(entries.filter((e) => e.date === yesterday).map((e) => ONE_BY_ID[e.ex].group));
  const dow = fromISO(t).getDay();

  const ranked = stats.map((s) => {
    const parts: { w: number; why: string }[] = [];
    const since = s.daysSince;
    const timeScore = since === null ? 24 : Math.min(since, 14) * 1.6;
    parts.push({ w: timeScore, why: since === null ? 'never done yet' : since === 0 ? 'done today' : `not done in ${since} day${since === 1 ? '' : 's'}` });
    const deficit = (avg30 - s.count30) * 2.5;
    if (deficit > 1) parts.push({ w: deficit, why: `behind your average (${s.count30} in 30 days)` });
    else parts.push({ w: Math.max(deficit, -6), why: '' });
    let pen = 0;
    if (since !== null && since < 3) pen = (3 - since) * 7;
    if (yGroups.has(s.def.group)) { pen += 6; }
    const restedWhy = !yGroups.has(s.def.group) && yGroups.size && (since === null || since >= 3) ? `${s.def.group === 'legs' ? 'leg' : s.def.group} muscles are rested` : '';
    let bonus = 0; let dayWhy = '';
    if (dow === 3 && (s.def.id === 'splits' || s.def.id === 'rdls')) { bonus = 5; dayWhy = 'good for a hip mobility day'; }
    if (dow === 0 && (s.def.id === 'rows' || s.def.id === 'pushups')) { bonus = 5; dayWhy = 'easy on a shoulder and spine day'; }
    const score = parts.reduce((a, p) => a + p.w, 0) - pen + bonus;
    const why = [parts[0].why, parts[1].why, restedWhy, dayWhy].filter(Boolean).slice(0, 3).join(', ');
    return { id: s.def.id, score, reason: why.charAt(0).toUpperCase() + why.slice(1) };
  });
  return ranked.sort((a, b) => b.score - a.score);
}

/** 0..4 level for a heatmap cell from reps done that day. */
export const levelOf = (reps: number) => (reps <= 0 ? 0 : reps < 8 ? 1 : reps < 20 ? 2 : reps < 40 ? 3 : 4);
