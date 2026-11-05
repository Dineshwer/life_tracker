import type { Stat, XPEvent } from '../types';

export const STATS: Stat[] = ['body', 'mind', 'skill', 'discipline'];
export const STAT_LABEL: Record<Stat, string> = { body: 'Body', mind: 'Mind', skill: 'Skill', discipline: 'Discipline' };

/** XP needed to go from level L to L+1. Gentle curve. */
export const xpForLevel = (level: number) => Math.round(100 + (level - 1) * 60 + Math.pow(level - 1, 1.6) * 8);

export interface LevelInfo { level: number; into: number; need: number; pct: number; total: number }

/** Total XP (never negative) -> level info. Level never drops below what's earned; floor at 0 total. */
export function levelFromXP(totalRaw: number): LevelInfo {
  const total = Math.max(0, totalRaw);
  let level = 1, rest = total;
  while (rest >= xpForLevel(level)) { rest -= xpForLevel(level); level++; }
  const need = xpForLevel(level);
  return { level, into: rest, need, pct: rest / need, total };
}

export function sumByStat(events: XPEvent[]): Record<Stat, number> {
  const out: Record<Stat, number> = { body: 0, mind: 0, skill: 0, discipline: 0 };
  for (const e of events) out[e.stat] += e.amount;
  for (const s of STATS) out[s] = Math.max(0, out[s]);
  return out;
}

/** Overall level is derived from the combined XP of all four stats. */
export const overallXP = (events: XPEvent[]) => Object.values(sumByStat(events)).reduce((a, b) => a + b, 0);

export const TASK_XP = { 1: 10, 2: 20, 3: 40 } as const;
export const MISSED_PENALTY = 8; // per missed scheduled habit-day, applied by store.settleDay
