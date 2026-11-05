import { REJECTION_GOAL, rejectionProgress } from '../../lib/rejections';
import './rejections.css';

const TEN = Array.from({ length: 10 }, (_, i) => i);

/** Three nested layers: the 1,000 (ten blocks), the current block of 100 (ten cells), the current run of 10 (ten dots). */
export default function RejectionMeter({ total, compact = false }: { total: number; compact?: boolean }) {
  const p = rejectionProgress(total);
  const blockLabel = p.done ? 'All blocks complete' : `Block ${p.blocks + 1} of 10`;

  return (
    <div className={`rm${compact ? ' rm-compact' : ''}`} role="group" aria-label={`${total} of ${REJECTION_GOAL} rejections`}>
      <div className="rm-layer">
        <div className="rm-head"><span className="label">The {REJECTION_GOAL.toLocaleString()}</span><span className="rm-count mono">{p.blocks} / 10 blocks</span></div>
        <div className="rm-segs" role="progressbar" aria-valuenow={total} aria-valuemin={0} aria-valuemax={REJECTION_GOAL}>
          {TEN.map((i) => {
            const fill = i < p.blocks ? 1 : i === p.blocks && !p.done ? p.inBlock / 100 : 0;
            return <span key={i} className={`rm-seg${fill === 1 ? ' full' : ''}`}><i style={{ ['--f' as string]: fill }} /></span>;
          })}
        </div>
      </div>

      <div className="rm-layer">
        <div className="rm-head"><span className="label">{blockLabel}</span><span className="rm-count mono">{p.inBlock} / 100</span></div>
        <div className="rm-cells">
          {TEN.map((i) => {
            const fill = i < p.cells ? 1 : i === p.cells && !p.done ? p.inRun / 10 : 0;
            return <span key={i} className={`rm-cell${fill === 1 ? ' full' : ''}`}><i style={{ ['--f' as string]: fill }} /></span>;
          })}
        </div>
      </div>

      <div className="rm-layer">
        <div className="rm-head"><span className="label">Current run</span><span className="rm-count mono">{p.inRun} / 10</span></div>
        <div className="rm-dots">
          {TEN.map((i) => <span key={i} className={`rm-dot${i < p.inRun ? ' on' : ''}`} />)}
        </div>
      </div>
    </div>
  );
}
