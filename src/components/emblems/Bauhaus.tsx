import type { EmblemProps } from './types';
import './bauhaus.css';

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const k = (lv: number) => clamp((lv - 1) / 10, 0, 1);

/** Bauhaus: four primitives, one per stat, sized by stat level, over a black level bar. */
export default function Bauhaus({ data }: EmblemProps) {
  const { body, mind, skill, discipline } = data.stats;
  const rc = 36 + 30 * k(body.level);        // circle radius
  const sm = 62 + 46 * k(mind.level);        // square side
  const tb = 66 + 46 * k(skill.level);       // triangle base
  const dr = 26 + 26 * k(discipline.level);  // semicircle radius
  const lvl = String(data.level).padStart(2, '0');
  const big = lvl.length <= 2;
  const filled = Math.round(clamp(data.pct, 0, 1) * 10);
  const pipFill = ['var(--body)', 'var(--mind)', 'var(--skill)', 'var(--discipline)'];
  const sw = 4;
  const GY = 160; // ground rule y
  return (
    <svg className="emb emb-bauhaus" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${data.level}, ${data.title}, ${Math.round(data.pct * 100)} percent to next level`}>
      <g transform="translate(0 6) scale(.9)">
      <g strokeLinejoin="miter" stroke="var(--text)" strokeWidth={sw}>
        <rect x={104} y={GY - sm - 4} width={sm} height={sm} fill="var(--mind)" />
        <circle cx={70} cy={GY - rc - 6} r={rc} fill="var(--body)" />
        <polygon points={`${196 - tb / 2},${GY - 4} ${196 + tb / 2},${GY - 4} 196,${GY - 4 - tb * 0.86}`} fill="var(--skill)" />
        <path d={`M ${150 - dr} ${GY - 4} A ${dr} ${dr} 0 0 1 ${150 + dr} ${GY - 4} Z`} fill="var(--discipline)" />
      </g>
      <rect x={0} y={GY} width={240} height={10} fill="var(--text)" />
      <rect x={0} y={GY + 10} width={240} height={86} fill="var(--text)" />
      <g className="emb-detail">
        <text x={14} y={GY + 30} className="bh-label" fill="var(--bg)">LEVEL</text>
        <text x={226} y={GY + 30} className="bh-label" textAnchor="end" fill="var(--bg)">{data.title.toUpperCase()}</text>
      </g>
      <text x={12} y={GY + 84} className="bh-num" fontSize={big ? 66 : 50} fill="var(--bg)">{lvl}</text>
      <g>
        {Array.from({ length: 10 }, (_, i) => {
          const x = 110 + i * 12.6, y = GY + 62, s = 10;
          const on = i < filled;
          const f = on ? pipFill[i % 4] : 'none';
          const st = { fill: f, stroke: on ? 'none' : 'var(--bg)', strokeWidth: 1.6 };
          const shape = i % 4;
          return shape === 0 ? <circle key={i} cx={x + s / 2} cy={y + s / 2} r={s / 2 - (on ? 0 : 0.8)} {...st} />
            : shape === 1 ? <rect key={i} x={x + (on ? 0 : .8)} y={y + (on ? 0 : .8)} width={s - (on ? 0 : 1.6)} height={s - (on ? 0 : 1.6)} {...st} />
            : shape === 2 ? <polygon key={i} points={`${x},${y + s} ${x + s},${y + s} ${x + s / 2},${y}`} {...st} />
            : <path key={i} d={`M ${x} ${y + s} A ${s / 2} ${s / 2} 0 0 1 ${x + s} ${y + s} Z`} {...st} />;
        })}
      </g>
      </g>
    </svg>
  );
}
