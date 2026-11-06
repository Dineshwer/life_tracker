import { useId, type ReactNode } from 'react';
import { useActiveSkin } from '../../lib/activeSkin';
import { useEmblemData } from '../emblems/useEmblemData';
import './levelmeter.css';

/** One level-up meter per skin. Every one is a different physical object, all static, all driven by the same pct. */
const W = 400, H = 40, X0 = 8, X1 = 392, SPAN = X1 - X0;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const PALETTE = ['var(--accent)', 'var(--accent-2)', 'var(--text)'];

/* deterministic jitter so a brush / tape edge never changes between renders */
const jit = (i: number) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };

function star(cx: number, cy: number, R: number, r: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5; const rad = i % 2 ? r : R;
    return `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`;
  }).join(' ');
}

type V = (p: number, id: string) => ReactNode;

const VARIANTS: Record<string, V> = {
  /* Canopy: a vine climbs the baseline, leaves along it, a bud at the tip */
  canopy: (p) => {
    const x = X0 + SPAN * p; const pts: string[] = []; const leaves: ReactNode[] = [];
    for (let px = X0; px <= x; px += 4) pts.push(`${px},${(22 + Math.sin(px / 18) * 4).toFixed(1)}`);
    for (let k = 1; X0 + k * 26 < x - 6; k++) {
      const lx = X0 + k * 26, ly = 22 + Math.sin(lx / 18) * 4, up = k % 2 ? -1 : 1;
      leaves.push(<path key={k} d="M0 0 C 4 -6, 11 -6, 15 0 C 11 5, 4 5, 0 0 Z" transform={`translate(${lx} ${ly}) rotate(${up * -38}) `} fill="var(--accent)" opacity={0.85} />);
    }
    return (<>
      <line x1={X0} x2={X1} y1={22} y2={22} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" />
      {p > 0 && <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />}
      {leaves}
      <circle cx={x} cy={22 + Math.sin(x / 18) * 4} r="5" fill="var(--accent-2)" />
      <circle cx={x} cy={22 + Math.sin(x / 18) * 4} r="9" fill="none" stroke="var(--accent-2)" strokeOpacity=".35" />
    </>);
  },

  /* Paper: ruled line, ten ink tally strokes that fill like an accountant's tally */
  paper: (p) => {
    const slots = 10, w = SPAN / slots, v = p * slots;
    return (<>
      <line x1={X0} x2={X1} y1={34} y2={34} stroke="var(--line-strong)" strokeWidth="1" />
      {Array.from({ length: slots }, (_, i) => {
        const f = clamp(v - i), cx = X0 + w * i + w / 2, tilt = (jit(i) - 0.5) * 3;
        return (<g key={i} transform={`rotate(${tilt} ${cx} 20)`}>
          <line x1={cx} x2={cx} y1={8} y2={32} stroke="var(--line)" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 5" />
          {f > 0 && <line x1={cx} x2={cx} y1={32} y2={32 - 24 * f} stroke="var(--accent)" strokeWidth="3.4" strokeLinecap="round" />}
        </g>);
      })}
    </>);
  },

  /* Grimoire: a glass vial of glowing liquid with a meniscus and a wax-seal stopper */
  grimoire: (p, id) => {
    const x = 34 + (352 - 34) * p;
    return (<>
      <defs>
        <clipPath id={`${id}c`}><rect x="34" y="8" width="318" height="24" rx="12" /></clipPath>
        <linearGradient id={`${id}l`} x1="0" x2="1"><stop offset="0" stopColor="var(--accent-2)" /><stop offset="1" stopColor="var(--accent)" /></linearGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect x="34" y="8" width="318" height="24" fill="var(--bg)" opacity=".6" />
        <rect x="34" y="8" width={Math.max(0, x - 34)} height="24" fill={`url(#${id}l)`} />
        {p > 0 && <ellipse cx={x} cy={20} rx="4" ry="12" fill="var(--accent)" />}
        {[0.22, 0.5, 0.74].map((b, i) => p * 1 > b * 0.85 && <circle key={i} cx={34 + 318 * b * p} cy={14 + i * 6} r={2 - i * 0.3} fill="var(--bg)" opacity=".5" />)}
      </g>
      <rect x="34" y="8" width="318" height="24" rx="12" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      {Array.from({ length: 9 }, (_, i) => <line key={i} x1={34 + 318 * (i + 1) / 10} x2={34 + 318 * (i + 1) / 10} y1="32" y2={i === 4 ? 38 : 35} stroke="var(--accent)" strokeOpacity=".6" />)}
      <rect x="352" y="13" width="14" height="14" rx="2" fill="var(--accent-2)" opacity=".8" />
      <circle cx="378" cy="20" r="11" fill="var(--danger)" opacity=".9" /><circle cx="378" cy="20" r="6" fill="none" stroke="var(--bg)" strokeOpacity=".5" />
      <circle cx="18" cy="20" r="9" fill="none" stroke="var(--accent)" strokeWidth="1.4" /><circle cx="18" cy="20" r="3" fill="var(--accent)" />
    </>);
  },

  /* Pop: ten stickers stars, each fills in; a partial star shows the leftover tenth */
  pop: (p, id) => {
    const v = p * 10, cols = ['var(--accent)', 'var(--accent-2)', 'var(--discipline)', 'var(--body)'];
    return (<>{Array.from({ length: 10 }, (_, i) => {
      const f = clamp(v - i), cx = X0 + 19 + i * 38.4;
      return (<g key={i}>
        <defs><clipPath id={`${id}${i}`}><rect x={cx - 19} y="0" width={38 * f} height={H} /></clipPath></defs>
        <polygon points={star(cx, 21, 17, 7.5)} fill="var(--card)" stroke="var(--text)" strokeWidth="2.4" strokeLinejoin="round" />
        {f > 0 && <polygon points={star(cx, 21, 17, 7.5)} fill={cols[i % 4]} stroke="var(--text)" strokeWidth="2.4" strokeLinejoin="round" clipPath={`url(#${id}${i})`} />}
      </g>);
    })}</>);
  },

  /* Arcade: segmented health bar of pixel blocks */
  arcade: (p) => {
    const n = 20, lit = Math.floor(p * n), half = p * n - lit > 0.5;
    return (<>
      <rect x="2" y="4" width="396" height="32" fill="none" stroke="var(--text)" strokeWidth="2" shapeRendering="crispEdges" />
      {Array.from({ length: n }, (_, i) => {
        const on = i < lit, part = i === lit && half;
        return <rect key={i} x={8 + i * 19.2} y="9" width="15" height="22" shapeRendering="crispEdges"
          fill={on ? (i > n * 0.7 ? 'var(--accent-2)' : 'var(--accent)') : part ? 'var(--accent)' : 'none'} fillOpacity={part ? 0.5 : 1}
          stroke={on || part ? 'none' : 'var(--line-strong)'} strokeWidth="2" />;
      })}
    </>);
  },

  /* Sumi: one brush stroke, painted left to right over a faint pencil guide */
  sumi: (p) => {
    const end = X0 + SPAN * p, top: string[] = [], bot: string[] = [];
    for (let x = X0; x <= end; x += 3) {
      const taper = Math.min(1, (x - X0) / 14, (end - x) / 10 + 0.35);
      const w = (11 + 6 * Math.sin(x / 21) + jit(x) * 3) * taper;
      top.push(`${x},${(20 - w / 2).toFixed(1)}`); bot.unshift(`${x},${(20 + w / 2 + Math.sin(x / 9) * 0.6).toFixed(1)}`);
    }
    return (<>
      <line x1={X0} x2={X1} y1={20} y2={20} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="1 5" />
      {p > 0 && <polygon points={[...top, ...bot].join(' ')} fill="var(--text)" opacity=".92" />}
      {p > 0 && [-5, 0, 5].map((o, i) => <line key={i} x1={end + 2} x2={end + 9 + jit(i) * 12} y1={20 + o} y2={20 + o + (jit(i + 4) - 0.5) * 3} stroke="var(--text)" strokeOpacity=".45" strokeWidth="1.2" strokeLinecap="round" />)}
      {p > 0 && <rect x={X1 - 12} y="9" width="12" height="12" fill="var(--accent)" opacity={p >= 1 ? 1 : 0.35} />}
    </>);
  },

  /* Bauhaus: ten primary forms (square, circle, triangle), solid when earned */
  bauhaus: (p, id) => {
    const v = p * 10;
    return (<>{Array.from({ length: 10 }, (_, i) => {
      const f = clamp(v - i), x = X0 + i * 38.4 + 2, c = PALETTE[i % 3], kind = i % 3;
      const shape = (fill: string, stroke: string, extra?: object) =>
        kind === 0 ? <rect x={x} y="6" width="30" height="30" fill={fill} stroke={stroke} strokeWidth="2.4" {...extra} />
          : kind === 1 ? <circle cx={x + 15} cy="21" r="15" fill={fill} stroke={stroke} strokeWidth="2.4" {...extra} />
            : <polygon points={`${x},36 ${x + 30},36 ${x + 15},6`} fill={fill} stroke={stroke} strokeWidth="2.4" {...extra} />;
      return (<g key={i}>
        <defs><clipPath id={`${id}${i}`}><rect x={x - 2} y="0" width={34 * f} height={H} /></clipPath></defs>
        {shape('none', 'var(--text)', { strokeOpacity: 0.55 })}
        {f > 0 && shape(c, 'var(--text)', { clipPath: `url(#${id}${i})` })}
      </g>);
    })}</>);
  },

  /* Riso: a halftone ramp, dots swell from specks to full as the ink lays down */
  riso: (p) => {
    const n = 32, lit = p * n;
    return (<>{Array.from({ length: n }, (_, i) => {
      const x = X0 + 6 + i * 11.9, on = i < lit, r = 1.6 + (i / n) * 5.6;
      return (<g key={i}>
        {on ? (<>
          <circle cx={x + 1.5} cy={22.5} r={r} fill="var(--accent-2)" opacity=".75" />
          <circle cx={x} cy={21} r={r} fill="var(--accent)" opacity=".9" />
        </>) : <circle cx={x} cy={21} r={1.5} fill="var(--line-strong)" />}
      </g>);
    })}</>);
  },

  /* Blueprint: an engineering dimension line, hatched fill, labelled in drafting type */
  blueprint: (p, id) => {
    const x = X0 + SPAN * p;
    return (<>
      <defs><pattern id={`${id}h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--accent)" strokeWidth="2" /></pattern></defs>
      <rect x={X0} y="20" width={SPAN} height="14" fill="none" stroke="var(--line-strong)" />
      <rect x={X0} y="20" width={Math.max(0, x - X0)} height="14" fill={`url(#${id}h)`} stroke="var(--accent)" />
      {Array.from({ length: 11 }, (_, i) => <line key={i} x1={X0 + SPAN * i / 10} x2={X0 + SPAN * i / 10} y1={i % 5 === 0 ? 10 : 14} y2={20} stroke="var(--accent)" strokeOpacity=".7" />)}
      <line x1={X0} x2={X1} y1={12} y2={12} stroke="var(--accent)" strokeOpacity=".7" />
      <polygon points={`${X0},12 ${X0 + 7},9 ${X0 + 7},15`} fill="var(--accent)" /><polygon points={`${X1},12 ${X1 - 7},9 ${X1 - 7},15`} fill="var(--accent)" />
      <path d={`M${x} 38 V 20`} stroke="var(--accent-2)" strokeWidth="2" />
      <text x={X0 + SPAN / 2} y="8" textAnchor="middle" fontSize="8.5" fill="var(--accent)" style={{ fontFamily: 'var(--font-mono, monospace)', letterSpacing: '.08em' }}>{Math.round(p * 100)}% COMPLETE</text>
    </>);
  },

  /* Swiss: one bar, the percentage cut through it in two inks */
  swiss: (p, id) => {
    const x = X0 + SPAN * p;
    return (<>
      <defs>
        <clipPath id={`${id}a`}><rect x={X0} y="0" width={Math.max(0, x - X0)} height={H} /></clipPath>
        <clipPath id={`${id}b`}><rect x={x} y="0" width={Math.max(0, X1 - x)} height={H} /></clipPath>
      </defs>
      <rect x={X0} y="4" width={SPAN} height="32" fill="none" stroke="var(--text)" strokeWidth="2.5" />
      <rect x={X0} y="4" width={Math.max(0, x - X0)} height="32" fill="var(--text)" />
      <text x={X0 + 10} y="29" fontSize="25" fontWeight="800" fill="var(--bg)" clipPath={`url(#${id}a)`} style={{ fontFamily: 'var(--font-display)', letterSpacing: '-.02em' }}>{Math.round(p * 100)}%</text>
      <text x={X0 + 10} y="29" fontSize="25" fontWeight="800" fill="var(--text)" clipPath={`url(#${id}b)`} style={{ fontFamily: 'var(--font-display)', letterSpacing: '-.02em' }}>{Math.round(p * 100)}%</text>
      <rect x={x - 2} y="0" width="4" height="40" fill="var(--accent)" />
    </>);
  },

  /* Collage: a strip of torn tape that grows, a pinned label on the end, the rest only cut-marked */
  collage: (p) => {
    const x = X0 + SPAN * p, up: string[] = [], dn: string[] = [];
    for (let i = 0, px = X0; px <= x; i++, px += 6) { const j = jit(i) * 3; up.push(`${px},${8 + j}`); dn.unshift(`${px},${32 - jit(i + 9) * 3}`); }
    return (<>
      <rect x={X0} y="9" width={SPAN} height="22" fill="none" stroke="var(--text)" strokeOpacity=".4" strokeWidth="1.5" strokeDasharray="5 4" />
      {p > 0 && <g transform="rotate(-0.8 200 20)"><polygon points={[...up, `${x},20`, ...dn].join(' ')} fill="var(--accent)" opacity=".92" stroke="var(--text)" strokeWidth="1.4" strokeLinejoin="round" /></g>}
      <circle cx={x} cy="20" r="8" fill="var(--accent-2)" stroke="var(--text)" strokeWidth="2" />
      <circle cx={x - 1.5} cy="18.5" r="2.4" fill="var(--text)" opacity=".5" />
    </>);
  },

  /* Rings: an orbit line; its marker is a ring that fills clockwise, so the percent reads twice */
  rings: (p) => {
    const x = X0 + 20 + (SPAN - 40) * p, R = 15, C = 2 * Math.PI * R;
    return (<>
      <line x1={X0} x2={X1} y1={20} y2={20} stroke="var(--line)" strokeWidth="3" strokeLinecap="round" />
      <line x1={X0} x2={x} y1={20} y2={20} stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <circle cx={x} cy="20" r={R + 2} fill="var(--card)" />
      <circle cx={x} cy="20" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="4" />
      <circle cx={x} cy="20" r={R} fill="none" stroke="var(--accent-2)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${C * p} ${C}`} transform={`rotate(-90 ${x} 20)`} />
      <circle cx={x} cy="20" r="3.5" fill="var(--accent)" />
    </>);
  },

  /* Cyberpunk: an energy cell of skewed charge segments */
  cyberpunk: (p) => {
    const n = 20, lit = Math.round(p * n);
    return (<>
      <path d="M6 5 H372 L380 13 V27 L372 35 H6 Z" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      <rect x="383" y="14" width="9" height="12" fill="var(--accent)" />
      {Array.from({ length: n }, (_, i) => (
        <polygon key={i} points={`${14 + i * 17.4},31 ${19 + i * 17.4},9 ${30 + i * 17.4},9 ${25 + i * 17.4},31`}
          fill={i < lit ? (i >= n - 4 ? 'var(--accent-2)' : 'var(--accent)') : 'none'} stroke={i < lit ? 'none' : 'var(--line-strong)'} className={i < lit ? 'lm-glow' : undefined} />
      ))}
    </>);
  },
};

export default function LevelMeter({ className = '' }: { className?: string }) {
  const skin = useActiveSkin();
  const d = useEmblemData();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const p = clamp(d.pct), pct = Math.round(p * 100), left = Math.max(0, Math.round(d.need - d.into));
  const draw = VARIANTS[skin] ?? VARIANTS.canopy;
  return (
    <div className={`lm ${className}`} data-lm={skin} role="img" aria-label={`${pct} percent to level ${d.level + 1}, ${left} XP to go`}>
      <svg className="lm-svg" viewBox={`0 0 ${W} ${H}`}>{draw(p, id)}</svg>
      <div className="lm-read">
        <span className="lm-pct display">{pct}<small>%</small></span>
        <span className="lm-sub label">{left} XP to Lv {d.level + 1}</span>
      </div>
    </div>
  );
}
