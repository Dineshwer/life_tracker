import { useMemo, useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { Button, Field, Page, SectionHeader } from '../components/ui';
import type { Video } from '../types';
import './entertainment/entertainment.css';

/** Pull the 11-character video id out of any common YouTube link (watch, youtu.be, shorts, embed, live). */
export function parseYouTubeId(input: string): string | null {
  const t = input.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  try {
    const u = new URL(t.startsWith('http') ? t : `https://${t}`);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch { /* not a URL */ }
  return null;
}

const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

export default function Entertainment() {
  const videos = useStore((s) => s.videos);
  const addVideo = useStore((s) => s.addVideo);
  const setWatched = useStore((s) => s.setVideoWatched);
  const removeVideo = useStore((s) => s.removeVideo);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState<Video['tag']>('learn');
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'learn' | 'fun'>('all');

  const queue = useMemo(() => videos.filter((v) => !v.watchedAt && (filter === 'all' || v.tag === filter)).sort((a, b) => a.addedAt.localeCompare(b.addedAt)), [videos, filter]);
  const done = useMemo(() => videos.filter((v) => v.watchedAt).sort((a, b) => (b.watchedAt ?? '').localeCompare(a.watchedAt ?? '')), [videos]);
  const current = videos.find((v) => v.id === playing) ?? null;
  const weekAgo = Date.now() - 7 * 86400000;
  const weekCount = done.filter((v) => new Date(v.watchedAt!).getTime() >= weekAgo).length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const id = parseYouTubeId(url);
    if (!id) { setErr('That does not look like a YouTube link.'); return; }
    if (videos.some((v) => v.ytId === id)) { setErr('Already in your list.'); return; }
    let name = title.trim();
    if (!name) {
      // YouTube's oEmbed returns the title; if offline or blocked we fall back to a generic name you can see in the player.
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
        if (r.ok) name = (await r.json()).title ?? '';
      } catch { /* offline */ }
    }
    addVideo(id, name, tag);
    setUrl(''); setTitle(''); setErr('');
  }

  const Row = ({ v }: { v: Video }) => (
    <li className={`en-item ${v.watchedAt ? 'is-done' : ''}`}>
      <button className="en-thumb" onClick={() => setPlaying(v.id)} aria-label={`Play ${v.title}`}>
        <img src={thumb(v.ytId)} alt="" loading="lazy" />
        <span className="en-play" aria-hidden>▶</span>
      </button>
      <div className="en-body">
        <div className="en-title">{v.title}</div>
        <div className="en-meta"><span className={`en-tag ${v.tag}`}>{v.tag === 'learn' ? 'Learn' : 'Fun'}</span></div>
      </div>
      <div className="en-actions">
        <Button variant="text" onClick={() => setWatched(v.id, !v.watchedAt)}>{v.watchedAt ? 'Undo' : 'Watched'}</Button>
        <Button variant="text" className="en-del" onClick={() => removeVideo(v.id)} aria-label={`Remove ${v.title}`}>Remove</Button>
      </div>
    </li>
  );

  return (
    <Page title="Entertainment" kicker={`${queue.length} queued · ${weekCount} watched this week`}>
      <section className="card en-hub">
        <div>
          <div className="label">Find something worth watching</div>
          <p className="en-hub-line">HackerTube lists the videos Hacker News recommends. It cannot be shown inside Ledger, so open it, copy a link you like and add it below. You pick the video once, then watch it here, with no feed to scroll.</p>
        </div>
        <a className="btn btn-solid en-open" href="https://hackertube.org/" target="_blank" rel="noreferrer noopener">Open HackerTube</a>
      </section>

      {current && (
        <section className="en-player card">
          <div className="en-frame"><iframe src={`https://www.youtube-nocookie.com/embed/${current.ytId}?rel=0&autoplay=1`} title={current.title} allow="accelerometer; autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen /></div>
          <div className="en-player-bar">
            <div className="en-title">{current.title}</div>
            <div className="en-actions">
              <Button onClick={() => { setWatched(current.id, true); setPlaying(null); }}>Mark watched</Button>
              <Button variant="ghost" onClick={() => setPlaying(null)}>Close</Button>
            </div>
          </div>
        </section>
      )}

      <form className="card en-add" onSubmit={submit}>
        <div className="en-add-grid">
          <Field label="YouTube link"><input value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="https://www.youtube.com/watch?v=…" inputMode="url" required /></Field>
          <Field label="Title (optional)"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Filled in for you if left blank" /></Field>
        </div>
        <div className="en-add-foot">
          <div className="en-seg" role="group" aria-label="Type">
            <button type="button" className={tag === 'learn' ? 'on' : ''} onClick={() => setTag('learn')}>Learn</button>
            <button type="button" className={tag === 'fun' ? 'on' : ''} onClick={() => setTag('fun')}>Fun</button>
          </div>
          {err && <span className="en-err" role="alert">{err}</span>}
          <span className="en-sp" />
          <Button type="submit">Add to queue</Button>
        </div>
      </form>

      <SectionHeader label="Watch queue" right={
        <span className="en-filter">{(['all', 'learn', 'fun'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}</span>
      } />
      {queue.length ? <ul className="en-list">{queue.map((v) => <Row key={v.id} v={v} />)}</ul>
        : <p className="en-empty">{videos.length ? 'Nothing queued in this filter.' : 'Your queue is empty. Add a link above and it appears here.'}</p>}

      {done.length > 0 && (<>
        <SectionHeader label="Watched" right={`${done.length}`} />
        <ul className="en-list">{done.slice(0, 20).map((v) => <Row key={v.id} v={v} />)}</ul>
      </>)}
    </Page>
  );
}
