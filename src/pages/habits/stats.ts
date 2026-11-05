import type { Habit, HabitLog, ISODate } from '../../types';
import { addDays, fromISO, today, weekDays, weekStart } from '../../lib/dates';

export const isSched = (h: Habit, d: ISODate) =>
  h.cadence.type === 'daily' || (h.cadence.type === 'days' && h.cadence.days.includes(fromISO(d).getDay()));

export const logSet = (logs: HabitLog[], id: string) => new Map(logs.filter((l) => l.habitId === id).map((l) => [l.date, l]));

/** Streak: consecutive scheduled days with a log (weeks meeting target for weekly habits). */
export function streak(h: Habit, logs: Map<string, HabitLog>): { n: number; unit: 'd' | 'w' } {
  const t = today();
  if (h.cadence.type === 'weekly') {
    const per = h.cadence.perWeek; let n = 0; let ws = weekStart(t);
    const count = (w: ISODate) => weekDays(w).filter((d) => logs.has(d)).length;
    if (count(ws) >= per) n++;
    ws = addDays(ws, -7);
    for (let i = 0; i < 60 && count(ws) >= per; i++) { n++; ws = addDays(ws, -7); }
    return { n, unit: 'w' };
  }
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const d = addDays(t, -i);
    if (!isSched(h, d)) continue;
    if (logs.has(d)) n++;
    else if (i === 0) continue;
    else break;
  }
  return { n, unit: 'd' };
}

/** Last 7 days (incl. today): completed / scheduled, 0..1 */
export function weekly(h: Habit, logs: Map<string, HabitLog>): number {
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, -i));
  const done = days.filter((d) => logs.has(d)).length;
  if (h.cadence.type === 'weekly') return Math.min(1, done / h.cadence.perWeek);
  const sched = days.filter((d) => isSched(h, d)).length;
  return sched ? Math.min(1, days.filter((d) => isSched(h, d) && logs.has(d)).length / sched) : 0;
}

export const cadenceText = (h: Habit) => {
  const c = h.cadence;
  if (c.type === 'daily') return 'Daily';
  if (c.type === 'weekly') return `${c.perWeek}× a week`;
  return c.days.length ? ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].filter((_, i) => c.days.includes(i)).join(' ') : 'No days';
};
