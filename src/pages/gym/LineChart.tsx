import { useEffect, useRef, useState } from 'react';
import { fromISO } from '../../lib/dates';

interface Pt { date: string; value: number }

const niceStep = (range: number, n: number) => {
  const raw = range / n; const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};
const fmtD = (d: string) => fromISO(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function LineChart({ data, unit, decimals = 0, id = 'c' }: { data: Pt[]; unit: string; decimals?: number; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el); setW(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);
  if (data.length === 0) return <div className="gym-empty">Nothing to chart yet.</div>;

  const H = 220, L = 40, R = 14, T = 12, B = 26;
  const vals = data.map((d) => d.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, 4);
  const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
  const ticks: number[] = []; for (let v = y0; v <= y1 + 1e-9; v += step) ticks.push(v);
  const t0 = fromISO(data[0].date).getTime(), t1 = fromISO(data[data.length - 1].date).getTime();
  const X = (d: string) => (t1 === t0 ? L + (w - L - R) / 2 : L + ((fromISO(d).getTime() - t0) / (t1 - t0)) * (w - L - R));
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${X(d.date).toFixed(1)},${Y(d.value).toFixed(1)}`).join(' ');
  const cur = sel ?? data.length - 1; const c = data[cur];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left;
    let best = 0, bd = Infinity; data.forEach((d, i) => { const dd = Math.abs(X(d.date) - x); if (dd < bd) { bd = dd; best = i; } });
    setSel(best);
  };
  const xl = data.length > 1 ? [0, data.length - 1] : [0];
  return (
    <div className="gym-chart" ref={ref}>
      <div className="gym-chart-read">
        <span className="display gym-chart-val">{c.value.toFixed(decimals)}</span>
        <span className="gym-chart-unit">{unit}</span>
        <span className="label">{fmtD(c.date)}</span>
      </div>
      <svg width={w} height={H} onPointerMove={onMove} onPointerLeave={() => setSel(null)} role="img" aria-label="Progress chart">
        <defs>
          <linearGradient id={`gA-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--body)" stopOpacity="0.32" /><stop offset="1" stopColor="var(--body)" stopOpacity="0" /></linearGradient>
          <filter id={`gG-${id}`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={w - R} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth={0.5} />
            <text x={L - 8} y={Y(t) + 3.5} textAnchor="end" className="gym-axis">{Number.isInteger(t) ? t : t.toFixed(1)}</text>
          </g>
        ))}
        {xl.map((i) => (
          <text key={i} x={X(data[i].date)} y={H - 6} textAnchor={xl.length === 1 ? 'middle' : i === 0 ? 'start' : 'end'} className="gym-axis">{fmtD(data[i].date)}</text>
        ))}
        {data.length > 1 && <path d={`${path} L${X(data[data.length - 1].date).toFixed(1)},${H - B} L${X(data[0].date).toFixed(1)},${H - B} Z`} fill={`url(#gA-${id})`} />}
        <path d={path} fill="none" stroke="var(--body)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => i !== cur && <circle key={d.date} cx={X(d.date)} cy={Y(d.value)} r={2.4} fill="var(--bg)" stroke="var(--body)" strokeWidth={1.4} />)}
        <circle cx={X(c.date)} cy={Y(c.value)} r={9} fill="var(--body)" opacity={0.7} filter={`url(#gG-${id})`} />
        <circle cx={X(c.date)} cy={Y(c.value)} r={4.5} fill="var(--body)" stroke="var(--bg)" strokeWidth={2} />
      </svg>
    </div>
  );
}
