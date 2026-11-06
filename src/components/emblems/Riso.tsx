import { useId } from 'react';
import type { EmblemProps } from './types';
import './riso.css';

const Reg = ({ x, y }: { x: number; y: number }) => (
  <g className="rs-reg" transform={`translate(${x} ${y})`}>
    <circle r="5" fill="none" /><line x1="-8" y1="0" x2="8" y2="0" /><line x1="0" y1="-8" x2="0" y2="8" />
  </g>
);

/** Riso's emblem: two-ink overprint. Pink halftone disc (dots swell with progress), blue disc, misregistered numeral. */
export default function Riso({ data }: EmblemProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { level, title, pct } = data;
  const p = Math.max(0, Math.min(1, pct));
  const two = level >= 10;
  const dot = 0.9 + p * 2.9; // halftone dot radius, spacing 7
  const fs = two ? 124 : 168;
  const num = (cls: string, dx: number, dy: number) => (
    <text x={112 + dx} y={(two ? 168 : 182) + dy} textAnchor="middle" className={cls} fontSize={fs}
      {...(two ? { textLength: 176, lengthAdjust: 'spacingAndGlyphs' as const } : {})}>{level}</text>
  );
  return (
    <svg className="emb emb-riso" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${level}, ${title}, ${Math.round(p * 100)} percent to the next level`}>
      <defs>
        <pattern id={`${uid}h`} width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="3.5" cy="3.5" r={dot} className="rs-dot" />
        </pattern>
      </defs>
      <circle cx="130" cy="104" r="100" className="rs-pink rs-blend" opacity="0.55" />
      <circle cx="130" cy="104" r="100" fill={`url(#${uid}h)`} className="rs-blend" />
      <circle cx="82" cy="176" r="66" className="rs-blue rs-blend" />
      {num('rs-n rs-n-pink rs-blend', -4, -3)}
      {num('rs-n rs-n-blue rs-blend', 4, 3)}
      {num('rs-n rs-n-main', 0, 0)}
      <g className="rs-tag emb-detail">
        <rect x="14" y="224" width="176" height="28" />
        <text x="24" y="243" className="rs-tagt">LV {level} · {title.toUpperCase()}</text>
      </g>
      <g className="emb-detail">
        <Reg x={14} y={14} /><Reg x={226} y={14} /><Reg x={226} y={250} />
        <text x="226" y="48" textAnchor="end" className="rs-mono">{Math.round(p * 100)}% →</text>
      </g>
    </svg>
  );
}
