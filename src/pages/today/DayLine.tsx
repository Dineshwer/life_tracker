import { useStore } from '../../store';
import type { TimeBlock } from '../../types';
import { fmtTime, minutes, today } from '../../lib/dates';
import { RingTap } from './RingTap';
import { blocksForDay, statVar } from './helpers';

export function DayLine({ nowMin, rise }: { nowMin: number; rise?: () => Record<string, number> }) {
  const blocks = useStore((s) => s.blocks);
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.habitLogs);
  const logHabit = useStore((s) => s.logHabit);
  const d = today();
  const list = blocksForDay(blocks, d);

  if (!list.length) return <p className="t-empty">No blocks are set for today. The day is open.</p>;

  const row = (b: TimeBlock) => {
    const accent = b.kind === 'agency' ? 'var(--accent-2)' : undefined;
    const cur = nowMin >= minutes(b.start) && nowMin < minutes(b.end);
    const past = nowMin >= minutes(b.end);
    const h = b.habitId ? habits.find((x) => x.id === b.habitId) : undefined;
    const lvl = h ? logs.find((l) => l.habitId === h.id && l.date === d)?.level ?? 'none' : 'none';
    const muted = b.fixed || b.kind === 'fixed';
    return (
      <li key={b.id} style={{ ...(rise?.() ?? {}), ['--c' as string]: accent ?? (h ? statVar(h.stat) : 'var(--line-strong)') }} className={`rise dl-row${cur ? ' cur' : ''}${past ? ' past' : ''}${muted ? ' muted' : ''}${b.kind === 'agency' ? ' agency' : ''}`}>
        <span className="dl-time mono">{fmtTime(b.start)}</span>
        <span className="dl-dot" />
        <div className="dl-body card">
          <div className="dl-txt">
          <div className="dl-title">{b.title}{cur && <span className="dl-now label">Now</span>}</div>
          <div className="dl-sub">
            Until {fmtTime(b.end)}
            {b.kind === 'agency' && <> · protected commitment, minimum 1.5h</>}
            {muted && b.kind === 'fixed' && b.title === 'Job' && <> · fixed</>}
          </div>
          </div>
          {h && (
            <RingTap state={lvl} label={`Complete ${h.name}`} color={statVar(h.stat)}
              onFull={() => logHabit(h.id, d, 'full')} onMin={() => logHabit(h.id, d, 'min')} onClear={() => logHabit(h.id, d, null)} />
          )}
        </div>
      </li>
    );
  };
  return <ol className="dl">{list.map(row)}</ol>;
}
