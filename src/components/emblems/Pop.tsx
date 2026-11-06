import type { EmblemProps } from './types';
import './pop.css';

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function burst(cx: number, cy: number, ro: number, ri: number, n: number) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 ? ri : ro;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Pop: two stickers, LEVEL (with a chunky progress bar) over XP TODAY, thick outlines and baked hard shadows. */
export default function Pop({ data }: EmblemProps) {
  const pct = clamp01(data.pct);
  const digits = String(data.level).length;
  const size = digits === 1 ? 132 : 100;
  const xp = data.xpToday > 0 ? `+${data.xpToday}` : String(data.xpToday);
  const xpSize = xp.length <= 3 ? 38 : xp.length === 4 ? 32 : 26;
  const barX = 28, barW = 164;
  return (
    <svg className="emb emb-pop" viewBox="0 0 240 264" role="img"
      aria-label={`Level ${data.level}, ${data.title}, ${Math.round(pct * 100)} percent to next level, ${data.xpToday} XP today`}>

      <g transform="translate(3 8) scale(0.89)">      <g strokeLinejoin="round" strokeLinecap="round">
        {/* LEVEL sticker */}
        <g transform="rotate(-2 110 90)">
          <rect className="pop-sh1" x="16" y="14" width="200" height="164" rx="26" />
          <rect x="10" y="8" width="200" height="164" rx="26" fill="var(--accent-2)" stroke="var(--line-strong)" strokeWidth="5" />
          <text x="28" y="40" fontFamily="var(--font-ui)" fontWeight="800" fontSize="17" letterSpacing="1.5" fill="var(--surface)">LEVEL</text>
          <text x="24" y="136" fontFamily="var(--font-display)" fontWeight="800" fontSize={size} letterSpacing="-6" fill="var(--surface)"
            stroke="var(--line-strong)" strokeWidth="4" paintOrder="stroke">{data.level}</text>
          <rect x={barX - 6} y="146" width={barW + 12} height="14" rx="7" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="3.5" />
          {pct > 0 && <rect x={barX - 6 + 3} y="149" width={Math.max(8, (barW + 6) * pct)} height="8" rx="4" fill="var(--accent)" />}
        </g>
        {/* title pill, stuck on the corner */}
        <g transform="rotate(5 168 36)">
          <rect className="pop-sh2" x="124" y="26" width="96" height="30" rx="15" transform="translate(4 4)" />
          <rect x="120" y="22" width="96" height="30" rx="15" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="3.5" />
          <text x="168" y="43" textAnchor="middle" fontFamily="var(--font-ui)" fontWeight="800" fontSize={data.title.length > 8 ? 14 : 16}
            letterSpacing="0.5" fill="var(--text)" style={{ textTransform: 'uppercase' }}>{data.title}</text>
        </g>
        {/* XP TODAY sticker */}
        <g transform="rotate(1.8 120 218)">
          <rect className="pop-sh3" x="22" y="194" width="200" height="62" rx="22" />
          <rect x="16" y="188" width="200" height="62" rx="22" fill="var(--accent)" stroke="var(--line-strong)" strokeWidth="5" />
          <text x="32" y="208" fontFamily="var(--font-ui)" fontWeight="800" fontSize="14" letterSpacing="1.5" fill="var(--accent-ink)">XP TODAY</text>
          <text x="32" y="242" fontFamily="var(--font-display)" fontWeight="800" fontSize={xpSize} letterSpacing="-2" fill="var(--accent-ink)">{xp}</text>
        </g>
        {data.xpToday > 0 && (
          <g className="pop-burst" transform="rotate(10 196 196)">
            <polygon points={burst(198, 202, 30, 21, 9)} transform="translate(3 3)" className="pop-sh3" />
            <polygon points={burst(198, 202, 30, 21, 9)} fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="3.5" />
            <text x="198" y="209" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="800" fontSize="19" fill="var(--text)">XP!</text>
          </g>
        )}
      </g>
    </g>
    </svg>
  );
}
