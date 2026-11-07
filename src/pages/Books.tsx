import { useMemo, useState, type FormEvent } from 'react';
import { useStore, uid } from '../store';
import { Bar, Button, Page, SectionHeader } from '../components/ui';
import { today } from '../lib/dates';
import type { Book } from '../types';
import './books/books.css';

type Kind = 'self' | 'story';
const SHELF: Record<Kind, { name: string; blurb: string; ph: string }> = {
  self: { name: 'Self-growth', blurb: 'Books that change how you work and live', ph: 'Atomic Habits' },
  story: { name: 'Stories', blurb: 'Novels and fiction, just for the pleasure', ph: 'The Alchemist' },
};
const kindOf = (b: Book): Kind => b.kind ?? 'self';

function Shelf({ kind }: { kind: Kind }) {
  const all = useStore((s) => s.books);
  const upsert = useStore((s) => s.upsert);
  const remove = useStore((s) => s.remove);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const books = useMemo(() => all.filter((b) => kindOf(b) === kind), [all, kind]);
  const reading = books.filter((b) => b.status === 'reading');
  const queued = books.filter((b) => b.status === 'queued');
  const done = books.filter((b) => b.status === 'done').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));

  function add(e: FormEvent) {
    e.preventDefault();
    const t = title.trim(); if (!t) return;
    const n = parseInt(pages, 10);
    upsert('books', { id: uid(), title: t, status: 'queued', kind, ...(author.trim() ? { author: author.trim() } : {}), ...(n > 0 ? { pages: n } : {}) });
    setTitle(''); setAuthor(''); setPages('');
  }
  const start = (b: Book) => upsert('books', { ...b, status: 'reading', startedAt: today() });
  const finish = (b: Book) => upsert('books', { ...b, status: 'done', finishedAt: today(), page: b.pages ?? b.page });
  const setPage = (b: Book, v: string) => { const n = Math.max(0, parseInt(v, 10) || 0); upsert('books', { ...b, page: b.pages ? Math.min(n, b.pages) : n }); };
  const rate = (b: Book, r: number) => upsert('books', { ...b, rating: b.rating === r ? undefined : r });

  return (
    <section className="bk-shelf card">
      <header className="bk-head">
        <div><h2 className="display bk-name">{SHELF[kind].name}</h2><p className="bk-blurb">{SHELF[kind].blurb}</p></div>
        <div className="bk-count"><b>{done.length}</b><span>finished</span></div>
      </header>

      <SectionHeader label="Reading now" right={reading.length || undefined} />
      {reading.length === 0 ? <p className="bk-empty">Nothing in your hands. Start one from Up next.</p> : (
        <ul className="bk-list">
          {reading.map((b) => (
            <li className="bk-item bk-now" key={b.id}>
              <div className="bk-main"><div className="bk-title">{b.title}</div>{b.author && <div className="bk-by">{b.author}</div>}</div>
              <div className="bk-prog">
                <label className="bk-pg">Page <input type="number" min={0} value={b.page ?? 0} onChange={(e) => setPage(b, e.target.value)} aria-label={`Current page of ${b.title}`} />{b.pages ? <span>of {b.pages}</span> : null}</label>
                {b.pages ? <Bar pct={(b.page ?? 0) / b.pages} height={4} /> : null}
              </div>
              <div className="bk-act"><Button variant="ghost" onClick={() => finish(b)}>Finished</Button><Button variant="text" onClick={() => upsert('books', { ...b, status: 'queued' })}>Pause</Button></div>
            </li>
          ))}
        </ul>
      )}

      <SectionHeader label="Up next" right={queued.length || undefined} />
      <form className="bk-add" onSubmit={add}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Add a book, e.g. ${SHELF[kind].ph}`} aria-label="Book title" />
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" aria-label="Author" />
        <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="Pages" inputMode="numeric" aria-label="Pages" className="bk-pages" />
        <Button type="submit">Add</Button>
      </form>
      {queued.length === 0 ? <p className="bk-empty">Your reading list is empty.</p> : (
        <ul className="bk-list">
          {queued.map((b) => (
            <li className="bk-item" key={b.id}>
              <div className="bk-main"><div className="bk-title">{b.title}</div><div className="bk-by">{[b.author, b.pages ? `${b.pages} pages` : ''].filter(Boolean).join(' · ')}</div></div>
              <div className="bk-act"><Button variant="ghost" onClick={() => start(b)}>Start reading</Button><Button variant="text" onClick={() => remove('books', b.id)} aria-label={`Remove ${b.title}`}>Remove</Button></div>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (<>
        <SectionHeader label="Finished" right={done.length} />
        <ul className="bk-list">
          {done.map((b) => (
            <li className="bk-item is-done" key={b.id}>
              <div className="bk-main"><div className="bk-title">{b.title}</div><div className="bk-by">{[b.author, b.finishedAt].filter(Boolean).join(' · ')}</div></div>
              <div className="bk-stars" role="group" aria-label={`Rate ${b.title}`}>{[1, 2, 3, 4, 5].map((r) => <button key={r} className={(b.rating ?? 0) >= r ? 'on' : ''} onClick={() => rate(b, r)} aria-label={`${r} star${r > 1 ? 's' : ''}`}>★</button>)}</div>
              <div className="bk-act"><Button variant="text" onClick={() => upsert('books', { ...b, status: 'queued', finishedAt: undefined })}>Reread</Button><Button variant="text" onClick={() => remove('books', b.id)} aria-label={`Remove ${b.title}`}>Remove</Button></div>
            </li>
          ))}
        </ul>
      </>)}
    </section>
  );
}

export default function Books() {
  const books = useStore((s) => s.books);
  const [tab, setTab] = useState<Kind>('self');
  const total = books.filter((b) => b.status === 'done').length;
  const now = books.filter((b) => b.status === 'reading').length;
  return (
    <Page title="Books" kicker={`${now} reading · ${total} finished`}>
      <div className="bk-tabs" role="tablist" aria-label="Shelf">
        {(['self', 'story'] as Kind[]).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{SHELF[k].name}</button>)}
      </div>
      <div className="bk-grid">
        <div className={`bk-col ${tab === 'self' ? 'show' : ''}`}><Shelf kind="self" /></div>
        <div className={`bk-col ${tab === 'story' ? 'show' : ''}`}><Shelf kind="story" /></div>
      </div>
    </Page>
  );
}
