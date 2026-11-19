import { useState, type FormEvent } from 'react';
import { TOPICS, FIN_SUBS, type FinSub, type TopicId } from '../contract';
import { Field } from '../../components/ui';

export function AddPlaylist({ onAdd, onCancel }: { onAdd: (url: string, title: string, topic: TopicId, sub?: FinSub) => boolean; onCancel: () => void }) {
  const [url, setUrl] = useState(''); const [name, setName] = useState('');
  const [topic, setTopic] = useState<TopicId>('tech'); const [sub, setSub] = useState<FinSub>('stocks');
  const [err, setErr] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Give the course a name.'); return; }
    if (!onAdd(url, name, topic, topic === 'fin' ? sub : undefined)) setErr('That does not look like a YouTube playlist link.');
  }
  return (
    <form className="cr-form card" onSubmit={submit} aria-label="Add a playlist" noValidate>
      <h3 className="cr-form-title">Add a playlist</h3>
      <Field label="Playlist link"><input value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="youtube.com/playlist?list=…" aria-invalid={!!err} /></Field>
      <Field label="Name"><input value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="What you call it" /></Field>
      <Field label="Topic">
        <select value={topic} onChange={(e) => setTopic(e.target.value as TopicId)}>{TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
      </Field>
      {topic === 'fin' && (
        <Field label="Finance type">
          <select value={sub} onChange={(e) => setSub(e.target.value as FinSub)}>{FIN_SUBS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </Field>
      )}
      {err && <p className="cr-err" role="alert">{err}</p>}
      <div className="cr-form-actions">
        <button type="submit" className="btn btn-solid cr-primary">Add course</button>
        <button type="button" className="btn btn-text cr-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
