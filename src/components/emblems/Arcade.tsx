import type { EmblemProps } from './types';
import './arcade.css';

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const CELLS = 20;

/** Arcade: angular HUD plate. Glowing numeral, 20-cell XP bar, four mini stat columns. */
export default function Arcade({ data }: EmblemProps) {
  const pct = clamp01(data.pct);
  const lit = Math.round(pct * CELLS);
  const num = String(data.level).padStart(2, '0');
  const size = num.length <= 2 ? 128 : 96;
  const x0 = 18, bw = 204, gap = 3, cw = (bw - gap * (CELLS - 1)) / CELLS;
  const xp = data.xpToday > 0 ? `+${data.xpToday}` : String(data.xpToday);
  const cols = [
    ['BDY', 'body'], ['MND', 'mind'], ['SKL', 'skill'], ['DSC', 'discipline'],
  ] as const;
  return (
    <svg className="emb emb-arc" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${data.level}, ${data.title}, ${lit} of ${CELLS} segments to next level, ${data.xpToday} XP today`}>

      <g transform="translate(3 10) scale(0.89)">      <path d="M4 4 H214 L236 26 V260 H26 L4 238 Z" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M12 12 H210 M12 252 H30" stroke="var(--line-strong)" strokeWidth="1" fill="none" />
      <text x={x0} y="32" fontFamily="var(--font-mono)" fontSize="13" letterSpacing="3" fill="var(--muted)">LEVEL</text>
      <text className="arc-xp" x="206" y="32" textAnchor="end" fontFamily="var(--font-display)" fontWeight="700" fontSize="20" fill="var(--accent-2)">{xp}</text>
      <text className="arc-num" x={x0 - 4} y="148" fontFamily="var(--font-display)" fontWeight="700" fontSize={size} fill="var(--accent)">{num}</text>
      <text x={x0} y="180" fontFamily="var(--font-display)" fontWeight="600" fontSize="22" letterSpacing="2.5" fill="var(--text)"
        style={{ textTransform: 'uppercase' }}>{data.title}</text>
      <g className="emb-detail" fontFamily="var(--font-mono)" fontSize="10" letterSpacing="1.5" fill="var(--muted)">
        <text x={x0} y="198">NEXT RANK</text>
        <text x={x0 + bw} y="198" textAnchor="end">{data.into} / {data.need}</text>
      </g>
      <g className="arc-bar">
        {Array.from({ length: CELLS }, (_, i) => (
          <rect key={i} x={x0 + i * (cw + gap)} y="204" width={cw} height="14" className={i < lit ? 'arc-on' : 'arc-off'}
            fill={i < lit ? 'var(--accent)' : 'color-mix(in srgb, var(--text) 14%, transparent)'} />
        ))}
      </g>
      <g className="emb-detail" fontFamily="var(--font-mono)">
        {cols.map(([lab, st], i) => {
          const x = x0 + i * 52;
          const c = `var(--${st})`;
          return (
            <g key={st}>
              <rect x={x} y="228" width="44" height="3" fill={c} />
              <text x={x} y="246" fontSize="9.5" letterSpacing="0.6" fill={c}>{lab}</text>
              <text x={x + 44} y="248" textAnchor="end" fontFamily="var(--font-display)" fontWeight="700" fontSize="17" fill="var(--text)">{data.stats[st].level}</text>
            </g>
          );
        })}
      </g>
    </g>
    </svg>
  );
}
