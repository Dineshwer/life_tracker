import type { EmblemProps } from './types';
import './swiss.css';

/** Swiss's emblem: a flat poster. Giant bleeding numeral, a solid signal-red disc carrying progress. */
export default function Swiss({ data }: EmblemProps) {
  const { level, title, pct, streak } = data;
  const p = Math.round(Math.max(0, Math.min(1, pct)) * 100);
  const two = level >= 10;
  return (
    <svg className="emb emb-swiss" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${level}, ${title}, ${p} percent to the next level`}>
      <g className="emb-detail">
        <line x1="0" y1="34" x2="214" y2="34" className="sw-rule" />
        <text x="0" y="13" className="sw-meta">Level {level}</text>
        <text x="0" y="26" className="sw-meta">{title}</text>
        <text x="214" y="13" textAnchor="end" className="sw-meta sw-red">Streak</text>
        <text x="214" y="26" textAnchor="end" className="sw-meta sw-red">{streak} {streak === 1 ? 'day' : 'days'}</text>
      </g>
      <text x="-6" y="256" className="sw-num" fontSize={two ? 240 : 290}
        {...(two ? { textLength: 206, lengthAdjust: 'spacingAndGlyphs' as const } : {})}>{level}</text>
      <circle cx="160" cy="196" r="60" className="sw-disc" />
      <text x="160" y="198" textAnchor="middle" className="sw-pct">{p}%</text>
      <text x="160" y="218" textAnchor="middle" className="sw-sub">to next</text>
    </svg>
  );
}
