import type { EmblemProps } from './types';
import './collage.css';

// Irregular torn edge: fixed jitter so it never re-rolls between renders
const JIT = [0, 4, -2, 5, -3, 2, 6, -1, 3, -4, 5, 0, -2, 4, 6, -3, 1, 5, -2, 3, 6, -1, 4, -3, 2, 5, 0, -2];
const torn = (cx: number, cy: number, r: number) =>
  JIT.map((j, i) => { const a = (i / JIT.length) * Math.PI * 2; const rr = r + j * 0.9 - 2; return `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`; }).join(' ');

/** Collage: tilted teal LEVEL badge on torn paper, washi tape title, marker numeral. */
export default function Collage({ data }: EmblemProps) {
  const cx = 120, cy = 118, R = 70;
  const lvl = String(data.level);
  const fs = lvl.length === 1 ? 104 : 80;
  const C = 2 * Math.PI * (R - 9);
  const pct = Math.max(0, Math.min(1, data.pct));
  const xp = data.xpToday;
  return (
    <svg className="emb emb-collage" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${data.level}, ${data.title}, ${Math.round(pct * 100)} percent to next level`}>
      <g transform="translate(0 6) scale(.9)">
      <g transform="rotate(8 120 130)">
        <polygon points={torn(cx + 5, cy + 7, 92)} className="cg-shadow" />
        <polygon points={torn(cx, cy, 92)} className="cg-paper" />
        <circle cx={cx} cy={cy} r={R + 6} className="cg-badge" />
        <circle cx={cx} cy={cy} r={R - 9} className="cg-track" fill="none" strokeWidth={5} strokeDasharray="2 5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={R - 9} className="cg-prog" fill="none" strokeWidth={5} strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`} transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cy - 45} textAnchor="middle" className="cg-small" fontSize={15} letterSpacing=".16em">LEVEL</text>
        <text x={cx} y={cy + fs * 0.34 + 2} textAnchor="middle" className="cg-num" fontSize={fs}>{lvl}</text>
        <rect x={cx - 30} y={cy - 108} width={60} height={20} className="cg-tape" transform={`rotate(-6 ${cx} ${cy - 98})`} />
        <g transform={`rotate(-3 ${cx} ${cy + 86})`}>
          <rect x={cx - 62} y={cy + 70} width={124} height={30} className="cg-tape" />
          <text x={cx} y={cy + 91} textAnchor="middle" className="cg-title" fontSize={19}>{data.title}</text>
        </g>
      </g>
      <g className="emb-detail" transform="rotate(-6 36 232)">
        <rect x={4} y={212} width={64} height={40} className="cg-note" />
        <text x={36} y={225} textAnchor="middle" className="cg-note-s" fontSize={8} letterSpacing=".1em">XP TODAY</text>
        <text x={36} y={246} textAnchor="middle" className="cg-note-n" fontSize={xp < -99 || xp > 999 ? 15 : 20}>{xp > 0 ? '+' : ''}{xp}</text>
      </g>
      </g>
    </svg>
  );
}
