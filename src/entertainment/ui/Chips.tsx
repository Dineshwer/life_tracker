import { TOPICS, FIN_SUBS, type TopicId, type FinSub } from '../contract';

/** Topic filter row. `available` limits chips to topics that have items; 'all' is always first. */
export function TopicChips({ value, onChange, available, sub, onSub }: {
  value: TopicId | 'all'; onChange: (t: TopicId | 'all') => void; available?: TopicId[];
  sub?: FinSub | 'all'; onSub?: (s: FinSub | 'all') => void;
}) {
  const topics = TOPICS.filter((t) => !available || available.includes(t.id));
  return (
    <div className="en-chipwrap">
      <div className="en-chiprow" role="group" aria-label="Topic">
        <button type="button" className={value === 'all' ? 'on' : ''} aria-pressed={value === 'all'} onClick={() => onChange('all')}>All</button>
        {topics.map((t) => <button key={t.id} type="button" className={value === t.id ? 'on' : ''} aria-pressed={value === t.id} onClick={() => onChange(t.id)}>{t.label}</button>)}
      </div>
      {value === 'fin' && onSub && (
        <div className="en-chiprow en-subrow" role="group" aria-label="Finance type">
          <button type="button" className={sub === 'all' || !sub ? 'on' : ''} aria-pressed={sub === 'all' || !sub} onClick={() => onSub('all')}>All finance</button>
          {FIN_SUBS.map((s) => <button key={s.id} type="button" className={sub === s.id ? 'on' : ''} aria-pressed={sub === s.id} onClick={() => onSub(s.id)}>{s.label}</button>)}
        </div>
      )}
    </div>
  );
}

/** Two-way segmented control (Mine | Suggested, All mixed | One channel). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number }[]; label: string }) {
  return (
    <div className="en-segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}{o.count !== undefined && <span className="en-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
