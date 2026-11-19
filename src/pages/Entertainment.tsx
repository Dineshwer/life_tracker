import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import { Button, Field, Page, SectionHeader } from '../components/ui';
import type { Video } from '../types';
import HackerTubeTab from './entertainment/HackerTubeTab';
import CoursesTab from '../entertainment/courses/CoursesTab';
import ChannelsTab from '../entertainment/channels/ChannelsTab';
import { PlayerProvider, usePlayer } from '../entertainment/ui/player';
import { Thumb } from '../entertainment/ui/Thumb';
import { parseYouTubeId } from './entertainment/parse';
import '../entertainment/ui/ui.css';
import './entertainment/entertainment.css';

export { parseYouTubeId };

const TABS = [{ id: 'hackertube', label: 'HackerTube' }, { id: 'courses', label: 'Courses' }, { id: 'channels', label: 'Channels' }, { id: 'saved', label: 'Saved' }] as const;
type TabId = (typeof TABS)[number]['id'];
const SKEY = 'ledger-ent-tab';
const initialTab = (): TabId => {
  try { const h = location.hash.slice(1); const v = TABS.find((t) => t.id === h) ?? TABS.find((t) => t.id === sessionStorage.getItem(SKEY)); if (v) return v.id; } catch { /* */ }
  return 'courses';
};

function SavedTab() {
  const { play } = usePlayer();
  const videos = useStore((s) => s.videos);
  const addVideo = useStore((s) => s.addVideo);
  const setWatched = useStore((s) => s.setVideoWatched);
  const removeVideo = useStore((s) => s.removeVideo);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState<Video['tag']>('learn');
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'all' | 'learn' | 'fun'>('all');

  const queue = useMemo(() => videos.filter((v) => !v.watchedAt && (filter === 'all' || v.tag === filter)).sort((a, b) => a.addedAt.localeCompare(b.addedAt)), [videos, filter]);
  const done = useMemo(() => videos.filter((v) => v.watchedAt).sort((a, b) => (b.watchedAt ?? '').localeCompare(a.watchedAt ?? '')), [videos]);

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
      <Thumb ytId={v.ytId} title={v.title} onPlay={() => play({ ytId: v.ytId, title: v.title })} />
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
    <>
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

      <SectionHeader label="Saved for later" right={
        <span className="en-filter">{(['all', 'learn', 'fun'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}</span>
      } />
      {queue.length ? <ul className="en-list">{queue.map((v) => <Row key={v.id} v={v} />)}</ul>
        : <p className="en-empty">{videos.length ? 'Nothing queued in this filter.' : 'Your queue is empty. Add a link above and it appears here.'}</p>}

      {done.length > 0 && (<>
        <SectionHeader label="Watched" right={`${done.length}`} />
        <ul className="en-list">{done.slice(0, 20).map((v) => <Row key={v.id} v={v} />)}</ul>
      </>)}
    </>
  );
}

export default function Entertainment() {
  const videos = useStore((s) => s.videos);
  const [tab, setTab] = useState<TabId>(initialTab);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => { try { sessionStorage.setItem(SKEY, tab); } catch { /* */ } }, [tab]);

  const queued = videos.filter((v) => !v.watchedAt).length;
  const weekAgo = Date.now() - 7 * 86400000;
  const weekCount = videos.filter((v) => v.watchedAt && new Date(v.watchedAt).getTime() >= weekAgo).length;

  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault(); setTab(TABS[n].id); refs.current[TABS[n].id]?.focus();
  };

  return (
    <Page title="Entertainment" kicker={`${queued} saved · ${weekCount} watched this week`}>
      <PlayerProvider>
        <div className="en-tabs" role="tablist" aria-label="Entertainment" onKeyDown={onKey}>
          {TABS.map((t) => (
            <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" id={`en-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="en-panel" tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div id="en-panel" role="tabpanel" aria-labelledby={`en-tab-${tab}`} className="en-panel">
          {tab === 'hackertube' && <HackerTubeTab />}
          {tab === 'courses' && <CoursesTab />}
          {tab === 'channels' && <ChannelsTab />}
          {tab === 'saved' && <SavedTab />}
        </div>
      </PlayerProvider>
    </Page>
  );
}
