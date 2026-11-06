import type { CSSProperties } from 'react';
import type { EmblemProps } from './types';
import './rings.css';

const ROWS = [
  { key: 'body', L: 'BODY', c: 'var(--body)', r: 106 },
  { key: 'mind', L: 'MIND', c: 'var(--mind)', r: 86 },
  { key: 'skill', L: 'SKILL', c: 'var(--skill)', r: 66 },
  { key: 'discipline', L: 'DISC', c: 'var(--discipline)', r: 46 },
] as const;

/** Rings: four concentric rounded progress rings, one per stat, level in the centre. */
export default function Rings({ data }: EmblemProps) {
  const cx = 120, cy = 122;
  const lvl = String(data.level);
  const fs = lvl.length === 1 ? 58 : 44;
  return (
    <svg className="emb emb-rings" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${data.level}, ${data.title}. Body ${Math.round(data.stats.body.pct * 100)}%, mind ${Math.round(data.stats.mind.pct * 100)}%, skill ${Math.round(data.stats.skill.pct * 100)}%, discipline ${Math.round(data.stats.discipline.pct * 100)}%`}>
      <g transform="translate(0 6) scale(.9)">
      <g transform={`rotate(-90 ${cx} ${cy})`} fill="none" strokeLinecap="round" strokeWidth={14}>
        {ROWS.map((row, i) => {
          const p = Math.max(0, Math.min(1, data.stats[row.key].pct)) * 100;
          return (
            <g key={row.key}>
              <circle cx={cx} cy={cy} r={row.r} className="rg-track" style={{ stroke: row.c }} />
              <circle cx={cx} cy={cy} r={row.r} pathLength={100} className="rg-bar"
                style={{ stroke: row.c, strokeDasharray: `${p || 0.01} 100`, ['--p' as string]: p, animationDelay: `${i * 90}ms` } as CSSProperties} />
            </g>
          );
        })}
      </g>
      <text x={cx} y={cy + fs * 0.35} textAnchor="middle" className="rg-num" fontSize={fs}>{lvl}</text>
      <g className="emb-detail">
        <text x={cx} y={cy - 22} textAnchor="middle" className="rg-small" fontSize={7.5} letterSpacing=".2em">LEVEL</text>
        {ROWS.map((row, i) => {
          const x = 12 + i * 60;
          return (
            <g key={row.key}>
              <circle cx={x + 4} cy={254} r={3.5} style={{ fill: row.c }} />
              <text x={x + 11} y={257} className="rg-small" fontSize={8.5} letterSpacing=".08em">{row.L} <tspan className="rg-lv">{data.stats[row.key].level}</tspan></text>
            </g>
          );
        })}
      </g>
      </g>
    </svg>
  );
}
