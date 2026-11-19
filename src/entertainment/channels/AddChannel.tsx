import { useState, type FormEvent } from 'react';
import { Button, Field } from '../../components/ui';
import { TOPICS, FIN_SUBS, type FinSub, type TopicId } from '../contract';
import { handleId, parseHandle } from './util';

/** Add a channel by handle or youtube.com/@handle link. Validates inline. */
export function AddChannel({ existing, onAdd }: { existing: Set<string>; onAdd: (handle: string, topic: TopicId, sub?: FinSub) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [topic, setTopic] = useState<TopicId>('mind');
  const [sub, setSub] = useState<FinSub>('investing');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = parseHandle(text);
    if ('error' in r) { setErr(r.error); setOk(''); return; }
    if (existing.has(handleId(r.handle))) { setErr('That channel is already in your list.'); setOk(''); return; }
    onAdd(r.handle, topic, topic === 'fin' ? sub : undefined);
    setErr(''); setText(''); setOk(`Added ${r.handle} to Mine.`);
  }
  if (!open) return <div className="ch-addwrap"><Button variant="ghost" onClick={() => { setOpen(true); setOk(''); }}>+ Add your own channel</Button>{ok && <p className="ch-ok" role="status">{ok}</p>}</div>;
  return (
    <form className="card ch-add" onSubmit={submit} noValidate aria-label="Add a channel">
      <Field label="Channel handle or link">
        <input value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} placeholder="@handle or youtube.com/@handle" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={!!err} aria-describedby={err ? 'ch-add-err' : undefined} />
      </Field>
      <Field label="Topic">
        <select value={topic} onChange={(e) => setTopic(e.target.value as TopicId)}>{TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
      </Field>
      {topic === 'fin' && <Field label="Finance type"><select value={sub} onChange={(e) => setSub(e.target.value as FinSub)}>{FIN_SUBS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>}
      {err && <p id="ch-add-err" className="ch-err" role="alert">{err}</p>}
      <div className="ch-row"><Button type="submit">Add channel</Button><Button type="button" variant="text" onClick={() => { setOpen(false); setErr(''); }}>Close</Button></div>
    </form>
  );
}
