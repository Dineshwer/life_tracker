import type { EmblemProps } from './types';
import './blueprint.css';

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const LEAF = (x: number, y: number, ang: number, s: number, key: string) => (
  <ellipse key={key} cx={x} cy={y} rx={s} ry={s * 0.46} transform={`rotate(${ang} ${x} ${y})`} />
);

/** Blueprint: the growth tree as an engineering schematic with dimension line and amber callouts. */
export default function Blueprint({ data }: EmblemProps) {
  const g = clamp((data.level - 1) / 12, 0, 1);
  const baseY = 226, x0 = 116;
  const trunkH = 78 + 100 * g, topY = baseY - trunkH;
  const sway = 4 + 4 * g;
  const trunk = `M ${x0} ${baseY} C ${x0 - sway} ${baseY - trunkH * 0.35}, ${x0 + sway} ${baseY - trunkH * 0.7}, ${x0} ${topY}`;
  const pt = (t: number) => ({ x: x0 + Math.sin(t * Math.PI * 1.6) * sway * 0.5 * (t < 0.85 ? 1 : 0.6), y: baseY - trunkH * t });
  const slots = [
    { key: 'body', L: 'B', t: 0.3, dir: -1 }, { key: 'mind', L: 'M', t: 0.44, dir: 1 },
    { key: 'skill', L: 'S', t: 0.64, dir: -1 }, { key: 'discipline', L: 'D', t: 0.8, dir: 1 },
  ] as const;
  const br = slots.map((s, i) => {
    const lv = data.stats[s.key].level;
    const kk = clamp((lv - 1) / 10, 0, 1);
    const len = 22 + 44 * kk, rise = 14 + 18 * kk;
    const p0 = pt(s.t);
    const p1 = { x: p0.x + s.dir * len, y: p0.y - rise };
    const c = { x: p0.x + s.dir * len * 0.45, y: p0.y - rise * 0.2 };
    const n = Math.min(7, 2 + Math.floor(lv / 2));
    const leaves = Array.from({ length: n }, (_, j) => {
      const u = n === 1 ? 1 : 0.3 + 0.7 * (j / (n - 1));
      const bx = (1 - u) ** 2 * p0.x + 2 * (1 - u) * u * c.x + u * u * p1.x;
      const by = (1 - u) ** 2 * p0.y + 2 * (1 - u) * u * c.y + u * u * p1.y;
      const side = j % 2 ? 1 : -1;
      const ang = (s.dir > 0 ? -30 : 210) + side * 38;
      return LEAF(bx, by, ang, 7 + 3 * kk + (j === n - 1 ? 1.5 : 0), `${i}-${j}`);
    });
    return { ...s, lv, d: `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`, p1, leaves };
  });
  // callouts: left column x=20, right column x=204; keep 26px apart
  const place = (items: typeof br) => {
    const sorted = [...items].sort((a, b) => a.p1.y - b.p1.y);
    let prev = -Infinity;
    return sorted.map((b) => { const cy = Math.max(16, b.p1.y - 16, prev + 27); prev = cy; return { b, cy }; });
  };
  const callouts = [...place(br.filter((b) => b.dir < 0)).map((o) => ({ ...o, cx: 20 })), ...place(br.filter((b) => b.dir > 0)).map((o) => ({ ...o, cx: 204 }))];
  const crownN = 3 + Math.min(3, Math.floor(data.level / 4));
  const lvl = String(data.level);
  return (
    <svg className="emb emb-blueprint" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${data.level}, ${data.title}, ${Math.round(data.pct * 100)} percent to next level`}>
      <g transform="translate(0 6) scale(.9)">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1={14} y1={baseY} x2={226} y2={baseY} stroke="var(--accent-2)" strokeWidth={1.3} strokeDasharray="6 4" />
        <path d={trunk} stroke="var(--text)" strokeWidth={3 + 1.4 * g} />
        {br.map((b) => <path key={b.key} d={b.d} stroke="var(--text)" strokeWidth={1.6} />)}
        <g stroke="var(--accent-2)" strokeWidth={1.4}>
          {br.map((b) => b.leaves)}
          {Array.from({ length: crownN }, (_, j) => LEAF(x0, topY, -90 + (j - (crownN - 1) / 2) * 34, 9 + 2 * g, `c${j}`))}
        </g>
        {/* dimension line */}
        <g stroke="var(--accent-2)" strokeWidth={1.2}>
          <line x1={228} y1={baseY} x2={228} y2={topY} />
          <line x1={222} y1={baseY} x2={234} y2={baseY} /><line x1={222} y1={topY} x2={234} y2={topY} />
        </g>
        <g className="emb-detail">
          {callouts.map(({ b, cx, cy }) => (
            <g key={b.key}>
              <path d={`M ${b.p1.x} ${b.p1.y} L ${cx} ${b.p1.y} L ${cx} ${cy}`} stroke="var(--accent)" strokeWidth={1} />
              <circle cx={cx} cy={cy} r={10} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.2} />
              <text x={cx} y={cy + 3.8} textAnchor="middle" className="bp-mono" fontSize={10.5} fontWeight={600} fill="var(--accent)" stroke="none">{b.L}</text>
              <text x={cx + (cx < 100 ? 15 : -15)} y={cy + 3.5} textAnchor={cx < 100 ? 'start' : 'end'} className="bp-mono" fontSize={9.5} fill="var(--muted)" stroke="none">{b.lv}</text>
            </g>
          ))}
          <text transform={`rotate(90 ${241} ${(baseY + topY) / 2})`} x={241} y={(baseY + topY) / 2} textAnchor="middle" className="bp-mono" fontSize={9.5} letterSpacing=".08em" fill="var(--accent-2)" stroke="none">LVL {lvl}</text>
          <text x={14} y={250} className="bp-mono" fontSize={9} letterSpacing=".12em" fill="var(--muted)" stroke="none">{data.title.toUpperCase()} · {Math.round(data.pct * 100)}%</text>
        </g>
        <g className="emb-compact">
          <text x={14} y={252} className="bp-mono" fontSize={22} fontWeight={600} fill="var(--accent)" stroke="none">LVL {lvl}</text>
          {callouts.map(({ b, cx, cy }) => (
            <g key={b.key}><path d={`M ${b.p1.x} ${b.p1.y} L ${cx} ${b.p1.y} L ${cx} ${cy}`} stroke="var(--accent)" strokeWidth={1.4} /><circle cx={cx} cy={cy} r={11} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.8} /><text x={cx} y={cy + 4.5} textAnchor="middle" className="bp-mono" fontSize={12} fontWeight={700} fill="var(--accent)" stroke="none">{b.L}</text></g>
          ))}
        </g>
      </g>
      </g>
    </svg>
  );
}
