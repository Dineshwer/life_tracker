import { useId } from 'react';
import type { EmblemProps } from './types';
import './cyberpunk.css';

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** Cyberpunk: a notched LV.NN slab over a huge glitch-offset numeral, an XP bar and four thin stat bars. */
export default function Cyberpunk({ data }: EmblemProps) {
  const uid = useId().replace(/:/g, '');
  const pct = clamp01(data.pct);
  const num = String(data.level).padStart(2, '0');
  const big = num.length <= 2 ? 215 : 160;
  const nx = 6, ny = 188;
  const cols = [['BDY', 'body'], ['MND', 'mind'], ['SKL', 'skill'], ['DSC', 'discipline']] as const;
  return (
    <svg className="emb emb-cyb" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${data.level}, ${data.title}, ${Math.round(pct * 100)} percent to next level`}>

      <g transform="translate(2 10) scale(0.89)">      <defs>
        <pattern id={`${uid}s`} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1.4" fill="var(--bg)" opacity="0.4" />
        </pattern>
      </defs>
      <g fontFamily="var(--font-display)" fontSize={big} letterSpacing="2">
        <text x={nx + 5} y={ny} fill="var(--danger)">{num}</text>
        <text x={nx - 5} y={ny} fill="var(--accent-2)">{num}</text>
        <text x={nx} y={ny} fill="var(--accent)">{num}</text>
        <text x={nx} y={ny} fill={`url(#${uid}s)`}>{num}</text>
      </g>
      {/* LV slab */}
      <g>
        <polygon points="110,6 234,6 234,52 94,52 94,22" fill="var(--accent)" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke" />
        <text x="214" y="43" textAnchor="end" fontFamily="var(--font-display)" fontSize="42" letterSpacing="1.5" fill="var(--accent-ink)">LV.{num}</text>
      </g>
      <text x={nx + 2} y="214" fontFamily="var(--font-mono)" fontSize="15" letterSpacing="3.5" fill="var(--text)" style={{ textTransform: 'uppercase' }}>
        {data.title}
      </text>
      {data.streak > 0 && <text className="emb-detail" x="232" y="214" textAnchor="end" fontFamily="var(--font-mono)" fontSize="11" letterSpacing="1.5" fill="var(--muted)">{data.streak}D STREAK</text>}
      {/* xp bar */}
      <rect x="8" y="224" width="224" height="9" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
      <rect className="cyb-fill" x="11" y="227" width={Math.max(0, 218 * pct)} height="3" fill="var(--accent)" />
      <rect x="8" y="224" width={Math.max(0, 224 * pct)} height="9" fill="color-mix(in srgb, var(--accent) 35%, transparent)" />
      <g className="emb-detail" fontFamily="var(--font-mono)" fontSize="11" letterSpacing="1">
        {cols.map(([lab, st], i) => {
          const x = 8 + i * 57;
          const s = data.stats[st];
          const c = `var(--${st})`;
          return (
            <g key={st}>
              <text x={x} y="248" fill={c}>{lab}.{String(s.level).padStart(2, '0')}</text>
              <rect x={x} y="253" width="52" height="4" fill="color-mix(in srgb, var(--text) 16%, transparent)" />
              <rect x={x} y="253" width={52 * clamp01(s.pct)} height="4" fill={c} />
            </g>
          );
        })}
      </g>
    </g>
    </svg>
  );
}
