import type { Stat } from '../../types';

export interface EmblemStat { level: number; /** 0..1 progress to next level of this stat */ pct: number; into: number; need: number }

/** Everything an emblem may show. All values are real, derived from the user's XP and habit logs. */
export interface EmblemData {
  level: number;            // overall level
  title: string;            // Seedling | Sapling | Rooted | Branching | Canopy
  band: number;             // 1..5 index of the title
  pct: number;              // 0..1 progress to next overall level
  into: number; need: number; total: number;   // XP into this level, XP needed for it, total XP
  stats: Record<Stat, EmblemStat>;
  xpToday: number;
  streak: number;           // consecutive days with at least one habit logged
}

/** Emblems are fluid: they fill their container's width (the hero slot is ~160px on phones, ~340px on desktop). */
export interface EmblemProps { data: EmblemData }
