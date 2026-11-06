import { addDays, today } from './dates';

/** Consecutive days (ending today, or yesterday if today is still empty) with at least one habit logged. */
export function currentStreak(logs: { date: string }[], t = today()): number {
  const days = new Set(logs.map((l) => l.date));
  let d = days.has(t) ? t : addDays(t, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
