import type { Habit, HabitLog, ISODate, TimeBlock } from '../../types';
import { fromISO, isWeekend, minutes, weekDays } from '../../lib/dates';

export const SLEEP = '23:00';

export const SKILL_OF_DAY: Record<number, { title: string; line: string }> = {
  1: { title: 'Cybersecurity', line: 'Monday belongs to cybersecurity. One concept, understood properly.' },
  2: { title: 'Drawing', line: 'Tuesday is for drawing. Hand and eye, slowly.' },
  3: { title: 'Reading deep-dive', line: 'Wednesday is a deep read. One text, given real attention.' },
  4: { title: 'Courses', line: 'Thursday is for coursework. Move one lesson forward.' },
  5: { title: 'Cybersecurity labs', line: 'Friday is cybersecurity labs. Hands on the keyboard.' },
  6: { title: 'Free build', line: 'Saturday is a free build. Make something without a brief.' },
  0: { title: 'Weekly review', line: 'Sunday is the weekly review. Look back, then set the week.' },
};

export const statVar = (s: string) => `var(--${s})`;

export function blocksForDay(blocks: TimeBlock[], date: ISODate) {
  const k = isWeekend(date) ? 'weekend' : 'weekday';
  return blocks.filter((b) => b.day === 'all' || b.day === k).sort((a, b) => minutes(a.start) - minutes(b.start));
}

export function dueToday(habits: Habit[], logs: HabitLog[], date: ISODate) {
  const dow = fromISO(date).getDay();
  const wk = weekDays(date);
  return habits.filter((h) => !h.archived).flatMap((h) => {
    const level: 'none' | 'min' | 'full' = logs.find((l) => l.habitId === h.id && l.date === date)?.level ?? 'none';
    if (h.cadence.type === 'daily') return [{ h, level, week: undefined as number | undefined }];
    if (h.cadence.type === 'days') return h.cadence.days.includes(dow) ? [{ h, level, week: undefined }] : [];
    const done = wk.filter((d) => logs.some((l) => l.habitId === h.id && l.date === d)).length;
    if (done >= h.cadence.perWeek && level === 'none') return [];
    return [{ h, level, week: done }];
  });
}

/** Free hours left today: remaining waking window minus fixed/agency blocks overlapping it. */
export function freeMinutesLeft(blocks: TimeBlock[], wake: string, nowMin: number) {
  const from = Math.max(nowMin, minutes(wake));
  const to = minutes(SLEEP);
  if (from >= to) return 0;
  let busy = 0;
  for (const b of blocks) {
    if (!(b.fixed || b.kind === 'fixed' || b.kind === 'agency')) continue;
    const s = Math.max(from, minutes(b.start)); const e = Math.min(to, minutes(b.end));
    if (e > s) busy += e - s;
  }
  return Math.max(0, to - from - busy);
}

export const fmtHours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
