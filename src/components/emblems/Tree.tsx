import Sapling from '../Sapling';
import { STATS } from '../../lib/xp';
import type { EmblemProps } from './types';
import type { Stat } from '../../types';

/** Canopy's emblem, and the safe fallback for any skin without its own: the growth tree. */
export default function Tree({ data }: EmblemProps) {
  const levels = Object.fromEntries(STATS.map((s) => [s, data.stats[s].level])) as Record<Stat, number>;
  return <Sapling levels={levels} overall={data.level} size="100%" className="emb emb-tree" />;
}
