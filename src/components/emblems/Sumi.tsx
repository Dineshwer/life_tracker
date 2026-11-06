import type { EmblemProps } from './types';
import './sumi.css';

const K = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function kanji(n: number): string {
  if (n <= 10) return K[n] || '〇';
  if (n < 20) return '十' + K[n - 10];
  if (n === 20) return '二十';
  return String(n);
}

const CX = 120, CY = 124, R = 88;
const rad = (d: number) => (d * Math.PI) / 180;

/** Sumi's emblem: a hand-brushed enso that closes as progress rises, a numeral inside, a vermilion seal with the level in kanji. */
export default function Sumi({ data }: EmblemProps) {
  const { level, title, pct } = data;
  const p = Math.max(0, Math.min(1, pct));
  const gap = 62 * (1 - p);                       // degrees of open ring
  const sweep = p >= 1 ? 372 : 360 - gap;
  const start = -80;                              // brush starts near the top and travels counter-clockwise
  const N = 30;
  const pt = (t: number, off = 0) => {
    const a = rad(start - sweep * t);
    const r = R + off + 2.4 * Math.sin(t * 7.1) + 1.6 * Math.sin(t * 17 + 1);
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const;
  };
  const width = (t: number) => {
    const ramp = Math.min(1, 0.55 + t * 4);
    const tail = t > 0.7 ? 1 - ((t - 0.7) / 0.3) * 0.78 : 1;
    return 3 + 15 * ramp * tail;
  };
  const segs = Array.from({ length: N }, (_, i) => {
    const t1 = i / N, t2 = (i + 1) / N;
    const [x1, y1] = pt(t1), [x2, y2] = pt(t2);
    return { i, d: `M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`, w: width((t1 + t2) / 2) };
  });
  const dry = Array.from({ length: 16 }, (_, i) => {
    const t1 = 0.05 + (i / 16) * 0.6, t2 = 0.05 + ((i + 1) / 16) * 0.6;
    const [x1, y1] = pt(t1, -5), [x2, y2] = pt(t2, -5);
    return { i, d: `M${x1.toFixed(1)} ${y1.toFixed(1)} A${R - 5} ${R - 5} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}` };
  });
  const two = level >= 10;
  const kj = kanji(level);
  const kfs = kj.length === 1 ? 32 : kj.length === 2 ? 25 : 18;
  return (
    <svg className="emb emb-sumi" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${level}, ${title}, ${Math.round(p * 100)} percent to the next level`}>
      <g transform="translate(-10 0)">
      <g className="sm-ink">
        <g className="sm-brush" fill="none" strokeLinecap="round">
          {segs.map((s) => <path key={s.i} d={s.d} strokeWidth={s.w} />)}
        </g>
        <g className="sm-dry" fill="none" strokeLinecap="round" strokeWidth="2.2" opacity="0.45">
          {dry.map((s) => <path key={s.i} d={s.d} />)}
        </g>
        <circle cx="202" cy="52" r="4.5" opacity="0.8" />
        <circle cx="216" cy="38" r="2.6" opacity="0.65" />
        <circle cx="190" cy="34" r="1.8" opacity="0.55" />
        <circle cx="224" cy="62" r="1.5" opacity="0.5" />
        <circle cx="30" cy="196" r="2" opacity="0.4" />
      </g>
      <text x="120" y={two ? 150 : 158} textAnchor="middle" className="sm-num" fontSize={two ? 70 : 92}>{level}</text>
      <g className="emb-detail">
        <text x="120" y="184" textAnchor="middle" className="sm-sub">{title.toUpperCase()}</text>
        <text x="120" y="80" textAnchor="middle" className="sm-sub">{Math.round(p * 100)}%</text>
      </g>
      <g transform="translate(188 204) rotate(4)" className="sm-seal">
        <rect x="-31" y="-31" width="62" height="62" rx="4" className="sm-seal-bg" />
        <rect x="-26" y="-26" width="52" height="52" rx="2" fill="none" className="sm-seal-line" />
        <text x="0" y="-15" textAnchor="middle" className="sm-lv">LV</text>
        <text x="0" y={kj.length === 1 ? 17 : 18} textAnchor="middle" className="sm-kanji" fontSize={kfs}>{kj}</text>
      </g>
      </g>
    </svg>
  );
}
