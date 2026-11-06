import { useId } from 'react';
import type { EmblemProps } from './types';
import './grimoire.css';

const CX = 120, CY = 108, R = 90;
const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** Grimoire: an ornate character plate. Gold double ring with an XP arc, Cinzel numeral, title ribbon, four stat gems. */
export default function Grimoire({ data }: EmblemProps) {
  const uid = useId().replace(/:/g, '');
  const pct = clamp01(data.pct);
  const digits = String(data.level).length;
  const size = digits === 1 ? 112 : digits === 2 ? 84 : 62;
  const baseY = digits === 1 ? CY + 38 : CY + 29;
  const gems = [
    { stat: 'body', x: CX - 64, y: CY + 64, shape: 'circle' },
    { stat: 'mind', x: CX + 64, y: CY + 64, shape: 'diamond' },
    { stat: 'skill', x: CX - 82, y: CY + 22, shape: 'diamond' },
    { stat: 'discipline', x: CX + 82, y: CY + 22, shape: 'circle' },
  ] as const;
  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  return (
    <svg className="emb emb-grim" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${data.level}, ${data.title}, ${Math.round(pct * 100)} percent to the next level`}>

      <g transform="translate(-3 6) scale(0.93)">      <circle cx={CX} cy={CY} r={R + 7} fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.5" opacity="0.9" />
      <circle cx={CX} cy={CY} r={R} fill="var(--surface)" stroke="color-mix(in srgb, var(--accent) 30%, transparent)" strokeWidth="7" />
      {/* xp arc */}
      <circle className="grim-arc" cx={CX} cy={CY} r={R} fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round"
        pathLength="100" strokeDasharray="100" strokeDashoffset={100 - pct * 100 + (pct > 0 && pct < 1 ? 0 : 0)}
        transform={`rotate(-90 ${CX} ${CY})`} style={pct <= 0 ? { opacity: 0 } : undefined} />
      <circle cx={CX} cy={CY} r={R - 8} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r={R - 14} fill="none" stroke="color-mix(in srgb, var(--accent) 55%, transparent)" strokeWidth="1" strokeDasharray="2 5" />
      <g className="emb-detail" stroke="var(--accent)" opacity="0.7">
        {ticks.map((a) => (
          <line key={a} x1={CX} y1={CY - R - 7} x2={CX} y2={CY - R - (a % 90 === 0 ? 13 : 10)} strokeWidth="1.2" transform={`rotate(${a} ${CX} ${CY})`} />
        ))}
      </g>
      <text x={CX} y={baseY} textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize={size}
        fill="var(--accent)" stroke="var(--bg)" strokeWidth="0.6" paintOrder="stroke">{data.level}</text>
      <text className="emb-detail" x={CX} y={CY - 40} textAnchor="middle" fontFamily="var(--font-display)" fontSize="10"
        letterSpacing="3" fill="var(--muted)">LEVEL</text>

      {/* ribbon */}
      <g>
        <path d="M30 206 L62 206 L62 232 L30 232 L40 219 Z" fill="var(--accent-2)" opacity="0.75" />
        <path d="M210 206 L178 206 L178 232 L210 232 L200 219 Z" fill="var(--accent-2)" opacity="0.75" />
        <path d="M52 198 H188 V228 H52 Z" fill="var(--accent-2)" stroke="var(--accent)" strokeWidth="1.5" />
        <path d="M52 198 L62 206 V236 L52 228 Z M188 198 L178 206 V236 L188 228 Z" fill="color-mix(in srgb, var(--accent-2) 60%, black)" opacity="0" />
        <text x={CX} y="219" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize={data.title.length > 8 ? 15 : 17}
          letterSpacing="2.5" fill="var(--bg)" style={{ textTransform: 'uppercase' }}>{data.title}</text>
      </g>
      <text className="emb-detail" x={CX} y="253" textAnchor="middle" fontFamily="var(--font-ui)" fontStyle="italic" fontSize="14" fill="var(--muted)">
        {data.into} / {data.need} XP
      </text>

      {/* stat gems */}
      <g className="emb-detail">
        {gems.map((g, i) => {
          const st = data.stats[g.stat];
          const gp = clamp01(st.pct);
          const r = 13;
          const shape = g.shape === 'circle'
            ? { d: `M${g.x - r} ${g.y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0Z` }
            : { d: `M${g.x} ${g.y - r - 2} L${g.x + r + 2} ${g.y} L${g.x} ${g.y + r + 2} L${g.x - r - 2} ${g.y}Z` };
          const color = `var(--${g.stat})`;
          const top = g.y + r + 2 - (2 * r + 4) * gp;
          const id = `${uid}g${i}`;
          return (
            <g key={g.stat}>
              <clipPath id={id}><rect x={g.x - r - 3} y={top} width={2 * r + 6} height={2 * r + 6} /></clipPath>
              <path d={shape.d} fill="var(--bg)" />
              <path d={shape.d} fill={color} clipPath={`url(#${id})`} opacity="0.9" />
              <path d={shape.d} fill="none" stroke={color} strokeWidth="2" />
              <text x={g.x} y={g.y + 4.5} textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize="12"
                fill="var(--text)" stroke="var(--bg)" strokeWidth="2.5" paintOrder="stroke">{st.level}</text>
            </g>
          );
        })}
      </g>
    </g>
    </svg>
  );
}
