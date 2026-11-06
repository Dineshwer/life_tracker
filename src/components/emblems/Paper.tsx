import { useId } from 'react';
import type { EmblemProps } from './types';
import './paper.css';

const TICKS = 60;
const fmtXp = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(Math.round(n))} XP`;

/** Paper's emblem: a rubber LEVEL stamp in terracotta ink, tilted, double ring, tick ring that fills with progress. */
export default function Paper({ data }: EmblemProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { level, title, pct, xpToday } = data;
  const filled = Math.round(Math.max(0, Math.min(1, pct)) * TICKS);
  const two = level >= 10;
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const r1 = major ? 78 : 80.5, r2 = 90;
    return { i, on: i < filled, x1: 120 + Math.cos(a) * r1, y1: 132 + Math.sin(a) * r1, x2: 120 + Math.cos(a) * r2, y2: 132 + Math.sin(a) * r2 };
  });
  return (
    <svg className="emb emb-paper" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${level}, ${title}, ${Math.round(pct * 100)} percent to the next level`}>
      <defs>
        <filter id={`${uid}b`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale="3" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="9" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  9 0 0 0 -2.3" result="s" />
          <feComposite in="d" in2="s" operator="in" />
        </filter>
        <filter id={`${uid}t`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="2" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  8 0 0 0 -1.5" result="s" />
          <feComposite in="SourceGraphic" in2="s" operator="in" />
        </filter>
      </defs>
      <g className="pp-stamp" transform="translate(-10 0) rotate(-10 120 132)">
        <circle cx="120" cy="132" r="104" className="pp-fill" />
        <g filter={`url(#${uid}b)`} className="pp-ink">
          <circle cx="120" cy="132" r="104" fill="none" strokeWidth="5" />
          <circle cx="120" cy="132" r="95.5" fill="none" strokeWidth="1.6" />
          <circle cx="120" cy="132" r="75" fill="none" strokeWidth="1.2" />
          {ticks.map((t) => (
            <line key={t.i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeLinecap="butt"
              strokeWidth={t.on ? 2.6 : 1.3} opacity={t.on ? 1 : 0.32} />
          ))}
        </g>
        <g filter={`url(#${uid}t)`} className="pp-text">
          <line x1="52" y1="80" x2="80" y2="80" strokeWidth="1.4" />
          <line x1="160" y1="80" x2="188" y2="80" strokeWidth="1.4" />
          <text x="120" y="85" textAnchor="middle" className="pp-lvl">LEVEL</text>
          <text x="120" y={two ? 148 : 154} textAnchor="middle" className="pp-num" fontSize={two ? 66 : 84}>{level}</text>
          <text x="120" y="178" textAnchor="middle" className="pp-title">{title.toUpperCase()}</text>
          <g className="emb-detail">
            <line x1="84" y1="188" x2="156" y2="188" strokeWidth="1.2" />
            <text x="120" y="204" textAnchor="middle" className="pp-xp">{fmtXp(xpToday)}</text>
          </g>
        </g>
      </g>
    </svg>
  );
}
