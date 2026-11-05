import { useMemo, useState } from 'react';
import type { Book, Conversation, JournalEntry } from '../../types';
import { Button, SectionHeader } from '../../components/ui';
import { useStore, uid } from '../../store';
import { addDays, fromISO, today } from '../../lib/dates';

export function Dots({ label, value, onChange, color }: { label: string; value?: number; onChange: (n: 1 | 2 | 3 | 4 | 5) => void; color: string }) {
  return (
    <div className="dots" role="group" aria-label={label} style={{ ['--c' as string]: color }}>
      <span className="label">{label}</span>
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button key={n} className={value !== undefined && n <= value ? 'on' : ''} aria-label={`${label} ${n}`} aria-pressed={value === n} onClick={() => onChange(n)}><i /></button>
      ))}
    </div>
  );
}

export function Sparkline({ entries }: { entries: JournalEntry[] }) {
  const W = 300, H = 80, P = 4;
  const days = Array.from({ length: 30 }, (_, i) => addDays(today(), i - 29));
  const x = (i: number) => P + (i * (W - 2 * P)) / 29;
  const y = (v: number) => H - P - ((v - 1) / 4) * (H - 2 * P);
  const series = (key: 'mood' | 'energy') => {
    const pts = days.map((d, i) => { const e = entries.find((j) => j.date === d && j.kind === 'daily'); const v = e?.[key]; return v ? { i, v } : null; });
    const segs: string[] = []; let cur = '';
    pts.forEach((p) => { if (p) cur += `${cur ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`; else if (cur) { segs.push(cur); cur = ''; } });
    if (cur) segs.push(cur);
    return { segs, pts: pts.filter(Boolean) as { i: number; v: number }[] };
  };
  const m = series('mood'), en = series('energy');
  return (
    <div>
      <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mood and energy, last 30 days">
        {[1, 3, 5].map((v) => <line key={v} x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />)}
        {en.segs.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--skill)" strokeWidth="1.25" strokeLinejoin="round" />)}
        {m.segs.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--mind)" strokeWidth="1.5" strokeLinejoin="round" />)}
        {m.pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="1.8" fill="var(--mind)" />)}
        {en.pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="1.8" fill="var(--skill)" />)}
      </svg>
      <div className="legend"><span><i style={{ background: 'var(--mind)' }} />Mood</span><span><i style={{ background: 'var(--skill)' }} />Energy</span><span style={{ marginLeft: 'auto' }}>30 days</span></div>
    </div>
  );
}

const BOOK_STATUS: Book['status'][] = ['queued', 'reading', 'done'];
const nextStatus = (s: Book['status']) => BOOK_STATUS[(BOOK_STATUS.indexOf(s) + 1) % BOOK_STATUS.length];

export function Books() {
  const books = useStore((s) => s.books);
  const upsert = useStore((s) => s.upsert);
  const remove = useStore((s) => s.remove);
  const [title, setTitle] = useState('');
  const add = () => { const t = title.trim(); if (!t) return; upsert('books', { id: uid(), title: t, status: 'queued' }); setTitle(''); };
  const order = { reading: 0, queued: 1, done: 2 };
  return (
    <section>
      <SectionHeader label="Books" right={books.length || undefined} />
      <form className="mini-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a title" aria-label="Book title" />
        <Button variant="ghost" type="submit">Add</Button>
      </form>
      {books.length === 0 ? <p className="j-empty">An empty shelf, waiting.</p> : (
        <div className="shelf">
          {[...books].sort((a, b) => order[a.status] - order[b.status]).map((b, i) => (
            <div className={`spine spine-${b.status} j-fx`} key={b.id} style={{ ['--i' as string]: i, ['--h' as string]: `${176 + ((i * 17) % 5) * 8}px` }}>
              <button className="spine-status" onClick={() => upsert('books', { ...b, status: nextStatus(b.status) })} aria-label={`${b.title}: ${b.status}. Change status`} title={`${b.status} (tap to change)`}><i /></button>
              <span className="spine-title display">{b.title}</span>
              <button className="spine-x" onClick={() => remove('books', b.id)} aria-label={`Remove ${b.title}`}>&times;</button>
            </div>
          ))}
        </div>
      )}
      <div className="shelf-legend"><span className="lg-reading">Reading</span><span className="lg-queued">Queued</span><span className="lg-done">Done</span></div>
    </section>
  );
}

export function Conversations() {
  const convs = useStore((s) => s.conversations);
  const upsert = useStore((s) => s.upsert);
  const [who, setWho] = useState(''); const [note, setNote] = useState('');
  const t = today();
  const streak = useMemo(() => {
    const set = new Set(convs.map((c) => c.date));
    let d = set.has(t) ? t : addDays(t, -1), n = 0;
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }, [convs, t]);
  const add = () => { const w = who.trim(); if (!w) return; upsert('conversations', { id: uid(), date: t, who: w, note: note.trim() || undefined } as Conversation); setWho(''); setNote(''); };
  const recent = [...convs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return (
    <section>
      <SectionHeader label="Conversations" />
      <div className="card conv j-fx" style={{ ['--i' as string]: 4 }}>
        <div className="streak"><b className="display">{streak}</b><span><span className="label">day streak</span><span className="streak-sub">of talking to someone new</span></span></div>
        <form className="mini-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who did you talk to?" aria-label="Who" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note (optional)" aria-label="Note" />
          <Button variant="ghost" type="submit">Log</Button>
        </form>
        {recent.map((c) => (
          <div className="list-row" key={c.id}>
            <span>{c.who}{c.note && <span style={{ color: 'var(--muted)' }}> &middot; {c.note}</span>}</span>
            <small>{fromISO(c.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
