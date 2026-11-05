import { addDays, today, weekStart } from '../../lib/dates';

const STEP = [null, 22, 42, 68, 100];
export const fillFor = (lvl: number, color: string) => (lvl <= 0 ? 'var(--line)' : `color-mix(in srgb, ${color} ${STEP[lvl]}%, transparent)`);

/** 12 weeks, Monday-start columns. level(date) -> 0..4, or -1 to leave blank. */
export default function Heatmap({ color, level, label }: { color: string; level: (d: string) => number; label: string }) {
  const t = today(); const start = addDays(weekStart(t), -77); const C = 10, G = 3;
  const cells = [];
  for (let w = 0; w < 12; w++) for (let r = 0; r < 7; r++) {
    const d = addDays(start, w * 7 + r); if (d > t) continue;
    const l = level(d); if (l < 0) continue;
    cells.push(<rect key={d} x={w * (C + G)} y={r * (C + G)} width={C} height={C} rx={2} fill={fillFor(l, color)}><title>{d}</title></rect>);
  }
  const W = 12 * (C + G) - G, H = 7 * (C + G) - G;
  return <svg className="hm" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>{cells}</svg>;
}
