import { useState } from 'react';
import type { Stat, Task, TaskContext } from '../../types';
import { Button, Field, Sheet } from '../../components/ui';
import { useStore, uid } from '../../store';
import { STATS, STAT_LABEL, TASK_XP } from '../../lib/xp';
import { today } from '../../lib/dates';

export const CONTEXTS: TaskContext[] = ['job', 'agency', 'personal', 'learning'];

interface Sub { id: string; title: string; done: boolean }

function Form({ task, onClose, defaults }: { task: Task | null; onClose: () => void; defaults: Partial<Task> }) {
  const all = useStore((s) => s.tasks);
  const upsert = useStore((s) => s.upsert);
  const remove = useStore((s) => s.remove);
  const existingSubs = task ? all.filter((t) => t.parentId === task.id) : [];

  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.date ?? defaults.date ?? '');
  const [context, setContext] = useState<TaskContext>(task?.context ?? defaults.context ?? 'personal');
  const [tags, setTags] = useState((task?.tags ?? []).join(', '));
  const [effort, setEffort] = useState<1 | 2 | 3>(task?.effort ?? 2);
  const [stat, setStat] = useState<Stat>(task?.stat ?? 'discipline');
  const [rec, setRec] = useState<'none' | 'day' | 'week' | 'month'>(task?.recurrence?.every ?? 'none');
  const [interval, setIntervalN] = useState(task?.recurrence?.interval ?? 1);
  const [horizon, setHorizon] = useState<'none' | 'short' | 'long'>((() => { const h = task ? task.horizon : defaults.horizon; return h === 'short' || h === 'long' ? h : 'none'; })());
  const [subs, setSubs] = useState<Sub[]>(existingSubs.map((s) => ({ id: s.id, title: s.title, done: s.done })));
  const [subDraft, setSubDraft] = useState('');

  const addSub = () => {
    const v = subDraft.trim();
    if (!v) return;
    setSubs([...subs, { id: uid(), title: v, done: false }]);
    setSubDraft('');
  };

  const save = () => {
    const t = title.trim();
    if (!t) return;
    const id = task?.id ?? uid();
    const next: Task = {
      ...(task ?? { done: false }),
      id, title: t, context, effort, stat,
      date: date || undefined,
      tags: tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
      recurrence: rec === 'none' ? undefined : { every: rec, interval: Math.max(1, interval) },
      horizon: horizon === 'none' ? (task?.horizon === 'today' ? 'today' : undefined) : horizon,
    };
    upsert('tasks', next);
    const keep = new Set(subs.map((s) => s.id));
    existingSubs.forEach((s) => { if (!keep.has(s.id)) remove('tasks', s.id); });
    subs.forEach((s) => {
      const prev = existingSubs.find((x) => x.id === s.id);
      upsert('tasks', prev ? { ...prev, title: s.title } : {
        id: s.id, title: s.title, done: false, parentId: id, context, tags: [], effort: 1, stat, date: date || undefined,
      });
    });
    onClose();
  };

  const del = () => {
    if (!task) return;
    existingSubs.forEach((s) => remove('tasks', s.id));
    remove('tasks', task.id);
    onClose();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} /></Field>
      <div className="form-row">
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Context">
          <select value={context} onChange={(e) => setContext(e.target.value as TaskContext)}>
            {CONTEXTS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Tags"><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated" /></Field>

      <div className="field">
        <span className="label">Effort</span>
        <div className="opts" role="group" aria-label="Effort">
          {([1, 2, 3] as const).map((n) => (
            <button type="button" key={n} className={effort === n ? 'on' : ''} onClick={() => setEffort(n)}>{n} · {TASK_XP[n]} XP</button>
          ))}
        </div>
      </div>
      <p className="hint">Light 10 XP, solid 20 XP, heavy 40 XP. Awarded to the stat below when completed.</p>

      <div className="form-row">
        <Field label="Stat">
          <select value={stat} onChange={(e) => setStat(e.target.value as Stat)}>
            {STATS.map((s) => <option key={s} value={s}>{STAT_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Horizon">
          <select value={horizon} onChange={(e) => setHorizon(e.target.value as 'none' | 'short' | 'long')}>
            <option value="none">None</option><option value="short">Short-term goal</option><option value="long">Long-term goal</option>
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="Repeat">
          <select value={rec} onChange={(e) => setRec(e.target.value as typeof rec)}>
            <option value="none">Never</option><option value="day">Every N days</option><option value="week">Every N weeks</option><option value="month">Every N months</option>
          </select>
        </Field>
        <Field label="N">
          <input type="number" min={1} value={interval} disabled={rec === 'none'} onChange={(e) => setIntervalN(Number(e.target.value) || 1)} />
        </Field>
      </div>

      <div className="field">
        <span className="label">Subtasks</span>
        {subs.map((s) => (
          <div className="sub-edit" key={s.id}>
            <span>{s.title}</span>
            <Button type="button" variant="text" onClick={() => setSubs(subs.filter((x) => x.id !== s.id))}>Remove</Button>
          </div>
        ))}
        <div className="sub-add">
          <input value={subDraft} placeholder="Add a step" onChange={(e) => setSubDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }} />
          <Button type="button" variant="ghost" onClick={addSub}>Add</Button>
        </div>
      </div>

      <div className="form-actions">
        {task ? <Button type="button" variant="text" className="danger-text" onClick={del}>Delete</Button> : <span />}
        <Button type="submit" disabled={!title.trim()}>Save</Button>
      </div>
    </form>
  );
}

export default function TaskSheet({ open, task, onClose, defaults }: { open: boolean; task: Task | null; onClose: () => void; defaults?: Partial<Task> }) {
  return (
    <Sheet open={open} onClose={onClose} title={task ? 'Edit task' : 'New task'}>
      <Form key={task?.id ?? 'new'} task={task} onClose={onClose} defaults={defaults ?? { date: today() }} />
    </Sheet>
  );
}
