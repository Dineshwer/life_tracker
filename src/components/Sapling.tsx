import { useMemo } from 'react';
import type { Stat } from '../types';

type Levels = Record<Stat, number>;
const COLOR: Record<Stat, string> = { body: 'var(--body)', mind: 'var(--mind)', skill: 'var(--skill)', discipline: 'var(--discipline)' };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A tree that grows with the character. Trunk follows overall level; each stat owns one branch. */
export default function Sapling({ levels, overall, size = 240, className }: { levels: Levels; overall: number; size?: number; className?: string }) {
  const art = useMemo(() => {
    const g = Math.min(1, (overall - 1) / 12);
    const trunkH = 46 + 104 * g;
    const baseY = 214, x = 100, topY = baseY - trunkH;
    const sway = 7 * (0.4 + g);
    const trunkW = 2.4 + 4.2 * g;
    const trunk = `M ${x} ${baseY} C ${x - sway} ${baseY - trunkH * 0.35}, ${x + sway} ${baseY - trunkH * 0.7}, ${x} ${topY}`;
    const point = (t: number) => { const y = baseY - trunkH * t; const dx = Math.sin(t * Math.PI * 1.6) * sway * 0.55; return { x: x + dx * (t < 0.85 ? 1 : 0.6), y }; };

    const slots: { stat: Stat; t: number; dir: -1 | 1 }[] = [
      { stat: 'body', t: 0.34, dir: -1 }, { stat: 'mind', t: 0.46, dir: 1 },
      { stat: 'skill', t: 0.66, dir: -1 }, { stat: 'discipline', t: 0.78, dir: 1 },
    ];
    const branches = slots.map((s, i) => {
      const lv = Math.max(1, levels[s.stat]);
      const k = Math.min(1, (lv - 1) / 10);
      const len = 14 + 46 * k + 8 * g;
      const p0 = point(s.t);
      const rise = 10 + 16 * k;
      const p1 = { x: p0.x + s.dir * len, y: p0.y - rise };
      const c = { x: p0.x + s.dir * len * 0.45, y: p0.y - rise * 0.2 };
      const d = `M ${p0.x} ${p0.y} Q ${c.x} ${c.y}, ${p1.x} ${p1.y}`;
      const r = rng(97 * (i + 3) + lv);
      const n = Math.min(16, 2 + Math.round(lv * 1.4));
      const leaves = Array.from({ length: n }, (_, j) => {
        const u = n === 1 ? 1 : 0.25 + 0.75 * (j / (n - 1));
        // point along the quadratic
        const bx = (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * c.x + u * u * p1.x;
        const by = (1 - u) * (1 - u) * p0.y + 2 * (1 - u) * u * c.y + u * u * p1.y;
        const side = j % 2 ? 1 : -1;
        const ang = (s.dir > 0 ? -35 : 215) + side * (35 + r() * 30) + (r() - 0.5) * 20;
        const sz = 4.2 + 3.4 * k + r() * 2.2;
        return { x: bx, y: by, ang, sz, o: 0.72 + r() * 0.28 };
      });
      return { ...s, d, leaves, p1 };
    });

    // crown sprout at the tip
    const crownN = Math.min(7, 2 + Math.round(overall * 0.55));
    const rc = rng(7 + overall);
    const crown = Array.from({ length: crownN }, (_, j) => ({ ang: -90 + (j - (crownN - 1) / 2) * 26 + (rc() - 0.5) * 10, sz: 5 + 3 * g + rc() * 2, o: 0.8 + rc() * 0.2 }));
    // Frame the picture around the tree so a young tree still fills its box (aspect stays 1 : 1.1)
    const h = Math.max(122, baseY + 12 - topY + 24);
    const w = h / 1.1;
    const vb = { x: 100 - w / 2, y: baseY + 12 - h, w, h };
    const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
    const groundRx = Math.min(70, w / 2 - 4);
    return { trunk, trunkW, branches, crown, topY, g, viewBox, vb, groundRx };
  }, [levels.body, levels.mind, levels.skill, levels.discipline, overall]);

  return (
    <svg className={className} width={size} height={size * 1.1} viewBox={art.viewBox} role="img" aria-label={`A tree grown to level ${overall}`}>
      <defs>
        <radialGradient id="sap-ground" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".28" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
        <radialGradient id="sap-halo" cx="50%" cy="46%" r="50%"><stop offset="0%" stopColor="var(--accent-2)" stopOpacity=".2" /><stop offset="70%" stopColor="var(--accent-2)" stopOpacity=".04" /><stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" /></radialGradient>
        <linearGradient id="sap-bark" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="var(--muted)" /><stop offset="100%" stopColor="var(--text)" stopOpacity=".85" /></linearGradient>
      </defs>
      <rect x={art.vb.x} y={art.vb.y} width={art.vb.w} height={art.vb.h} fill="url(#sap-halo)" />
      <ellipse cx="100" cy="216" rx={art.groundRx} ry="9" fill="url(#sap-ground)" />
      <path d={`M ${100 - art.groundRx + 6} 216 Q 100 211 ${100 + art.groundRx - 6} 216`} stroke="var(--line-strong)" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d={art.trunk} stroke="url(#sap-bark)" strokeWidth={art.trunkW} fill="none" strokeLinecap="round" style={{ transition: 'all .6s var(--ease)' }} />
      {art.branches.map((b) => (
        <g key={b.stat} style={{ color: COLOR[b.stat] }}>
          <path d={b.d} stroke="url(#sap-bark)" strokeWidth={1.6} fill="none" strokeLinecap="round" opacity=".9" />
          {b.leaves.map((l, i) => (
            <path key={i} d="M0 0 C 3 -4, 8 -4, 11 0 C 8 4, 3 4, 0 0 Z" transform={`translate(${l.x} ${l.y}) rotate(${l.ang}) scale(${l.sz / 9})`} fill="currentColor" opacity={l.o} />
          ))}
        </g>
      ))}
      <g style={{ color: 'var(--accent)' }}>
        {art.crown.map((c, i) => (
          <path key={i} d="M0 0 C 3 -4, 8 -4, 11 0 C 8 4, 3 4, 0 0 Z" transform={`translate(100 ${art.topY}) rotate(${c.ang}) scale(${c.sz / 9})`} fill="currentColor" opacity={c.o} />
        ))}
      </g>
    </svg>
  );
}
