import { useState } from 'react';
import type { Habit, Stat } from '../../types';
import { Button, Field, Sheet } from '../../components/ui';
import { STATS, STAT_LABEL } from '../../lib/xp';
import { uid } from '../../store';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
type Kind = 'daily' | 'weekly' | 'days';

export default function HabitSheet({ habit, open, onClose, onSave }: { habit: Habit | null; open: boolean; onClose: () => void; onSave: (h: Habit) => void }) {
  return <Sheet open={open} onClose={onClose} title={habit ? 'Edit habit' : 'New habit'}>{open && <Form key={habit?.id ?? 'new'} habit={habit} onSave={onSave} onClose={onClose} />}</Sheet>;
}

function Form({ habit, onSave, onClose }: { habit: Habit | null; onSave: (h: Habit) => void; onClose: () => void }) {
  const [name, setName] = useState(habit?.name ?? '');
  const [stat, setStat] = useState<Stat>(habit?.stat ?? 'mind');
  const [kind, setKind] = useState<Kind>(habit?.cadence.type ?? 'daily');
  const [per, setPer] = useState(habit?.cadence.type === 'weekly' ? habit.cadence.perWeek : 3);
  const [days, setDays] = useState<number[]>(habit?.cadence.type === 'days' ? habit.cadence.days : [1, 3, 5]);
  const [xp, setXp] = useState(habit?.xp ?? 15);
  const [min, setMin] = useState(habit?.minimum ?? '');
  const [ul, setUl] = useState(habit?.unit?.label ?? '');
  const [ut, setUt] = useState(habit?.unit?.target ?? 0);
  const valid = name.trim() && (kind !== 'days' || days.length > 0);

  const save = (archived?: boolean) => {
    const cadence: Habit['cadence'] = kind === 'daily' ? { type: 'daily' } : kind === 'weekly' ? { type: 'weekly', perWeek: Math.min(7, Math.max(1, per)) } : { type: 'days', days: [...days].sort() };
    onSave({ id: habit?.id ?? uid(), name: name.trim(), stat, cadence, xp: Math.max(1, xp), minimum: min.trim() || undefined, unit: ul.trim() && ut > 0 ? { label: ul.trim(), target: ut } : undefined, archived: archived ?? habit?.archived });
    onClose();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (valid) save(); }}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Stat"><select value={stat} onChange={(e) => setStat(e.target.value as Stat)}>{STATS.map((s) => <option key={s} value={s}>{STAT_LABEL[s]}</option>)}</select></Field>
      <Field label="Cadence"><select value={kind} onChange={(e) => setKind(e.target.value as Kind)}><option value="daily">Every day</option><option value="weekly">Times per week</option><option value="days">Specific days</option></select></Field>
      {kind === 'weekly' && <Field label="Times per week"><input type="number" min={1} max={7} value={per} onChange={(e) => setPer(+e.target.value)} /></Field>}
      {kind === 'days' && (
        <div className="field"><span className="label">Days</span>
          <div className="chips">{DAYS.map((d, i) => <button type="button" key={d} className="chip" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}>{d}</button>)}</div>
        </div>
      )}
      <Field label="XP for full completion"><input type="number" min={1} value={xp} onChange={(e) => setXp(+e.target.value)} /></Field>
      <Field label="Minimum version"><input value={min} placeholder="What still counts on a bad day" onChange={(e) => setMin(e.target.value)} /></Field>
      <div className="row2">
        <Field label="Unit (optional)"><input value={ul} placeholder="minutes" onChange={(e) => setUl(e.target.value)} /></Field>
        <Field label="Target"><input type="number" min={0} value={ut} onChange={(e) => setUt(+e.target.value)} /></Field>
      </div>
      <div className="sheet-actions">
        {habit ? <Button type="button" variant="ghost" onClick={() => save(!habit.archived)}>{habit.archived ? 'Restore' : 'Archive'}</Button> : <span />}
        <Button type="submit" disabled={!valid}>Save</Button>
      </div>
    </form>
  );
}
