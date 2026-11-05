export const REJECTION_GOAL = 1000;
export const REJECTION_XP = 10;

export interface RejectionProgress {
  total: number;
  /** completed blocks of 100 (outer layer) */
  blocks: number;
  /** progress inside the current block of 100 */
  inBlock: number;
  /** completed cells of 10 inside the current block (middle layer) */
  cells: number;
  /** progress inside the current run of 10 (inner layer) */
  inRun: number;
  pct: number;
  done: boolean;
}

export function rejectionProgress(total: number, goal = REJECTION_GOAL): RejectionProgress {
  const done = total >= goal;
  const t = Math.min(total, goal);
  const blocks = done ? goal / 100 : Math.floor(t / 100);
  const inBlock = done ? 100 : t % 100;
  return { total, blocks, inBlock, cells: Math.floor(inBlock / 10), inRun: done ? 10 : inBlock % 10, pct: t / goal, done };
}
