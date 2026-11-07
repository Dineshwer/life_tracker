import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Button, SectionHeader } from '../../components/ui';
import type { Channel } from '../../types';
import HackerTubeTab from './HackerTubeTab';
import { channelId, channelVideos } from '../../lib/mirror';

const HIDE = 'ledger-feed-hidden';
const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDE) || '[]'); } catch { return []; } };

/* ---- My YouTube: only the channels you picked, newest first, listed through public mirror servers ---------- */
type CV = { ytId: string; title: string; at: number; dur: number; channel: string; topic: Channel['topic'] };
type TopicTab = 'all' | 'sec' | 'psy' | 'per' | 'biz' | 'sci';
const CTOPICS: { id: TopicTab; label: string }[] = [{ id: 'all', label: 'Everything' }, { id: 'sec', label: 'Cybersecurity' }, { id: 'psy', label: 'Psychology' }, { id: 'per', label: 'Persuasion' }, { id: 'biz', label: 'Business' }, { id: 'sci', label: 'Science & computing' }];
const CCACHE = 'ledger-channels-v2';
const CTTL = 3 * 3600 * 1000;
const MIN_LEN = 4 * 60; // nothing under 4 minutes
const tabOf = (t: Channel['topic']): TopicTab => (t === 'code' ? 'sci' : t);

export function ChannelFeed({ onPlay }: { onPlay: (ytId: string, title: string) => void }) {
  const channels = useStore((s) => s.channels);
  const videos = useStore((s) => s.videos);
  const addVideo = useStore((s) => s.addVideo);
  const addChannel = useStore((s) => s.addChannel);
  const removeChannel = useStore((s) => s.removeChannel);
  const [items, setItems] = useState<CV[]>([]);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [topic, setTopic] = useState<TopicTab>('all');
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [manage, setManage] = useState(false);
  const [handle, setHandle] = useState('');
  const [ctopic, setCtopic] = useState<Channel['topic']>('sec');
  const sig = channels.map((c) => c.handle).sort().join(',');

  const refresh = useCallback(async (force = false) => {
    setFailed([]); setDone(0);
    if (!force) { try { const c = JSON.parse(localStorage.getItem(CCACHE) || 'null'); if (c && c.sig === sig && Date.now() - c.at < CTTL) { setItems(c.items); setBusy(false); setDone(channels.length); return; } } catch { /* */ } }
    setBusy(true); setItems([]);
    const acc: CV[] = []; const bad: string[] = []; let finished = 0; let next = 0;
    const worker = async () => {
      while (next < channels.length) {
        const c = channels[next++];
        try {
          const id = await channelId(c.handle, c.cid);
          if (!id) throw new Error('unknown');
          const vs = await channelVideos(id);
          acc.push(...vs.map((v) => ({ ytId: v.ytId, title: v.title, at: v.at, dur: v.dur, channel: v.author, topic: c.topic })));
          setItems([...acc]);
        } catch { bad.push(c.handle); setFailed([...bad]); }
        setDone(++finished);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    // Mirrors rate-limit bursts: give the channels that failed a second, slower try.
    for (const h of [...bad]) {
      const c = channels.find((x) => x.handle === h); if (!c) continue;
      await new Promise((r) => setTimeout(r, 900));
      try {
        const id = await channelId(c.handle, c.cid); if (!id) continue;
        const vs = await channelVideos(id);
        acc.push(...vs.map((v) => ({ ytId: v.ytId, title: v.title, at: v.at, dur: v.dur, channel: v.author, topic: c.topic })));
        bad.splice(bad.indexOf(h), 1); setItems([...acc]); setFailed([...bad]);
      } catch { /* stays in the failed list */ }
    }
    if (acc.length) { try { localStorage.setItem(CCACHE, JSON.stringify({ at: Date.now(), sig, items: acc })); } catch { /* */ } }
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => { refresh(); }, [refresh]);

  /** Retry only the channels that failed, keeping what already loaded. */
  const retryFailed = useCallback(async () => {
    const todo = channels.filter((c) => failed.includes(c.handle));
    if (!todo.length) return;
    setBusy(true);
    const acc = [...items]; const bad: string[] = [];
    for (const c of todo) {
      try {
        const id = await channelId(c.handle, c.cid); if (!id) throw new Error('unknown');
        const vs = await channelVideos(id);
        acc.push(...vs.map((v) => ({ ytId: v.ytId, title: v.title, at: v.at, dur: v.dur, channel: v.author, topic: c.topic })));
        setItems([...acc]);
      } catch { bad.push(c.handle); }
      setFailed([...bad, ...todo.slice(todo.indexOf(c) + 1).map((x) => x.handle)]);
    }
    setFailed(bad); setBusy(false);
    if (acc.length) { try { localStorage.setItem(CCACHE, JSON.stringify({ at: Date.now(), sig, items: acc })); } catch { /* */ } }
  }, [channels, failed, items, sig]);

  const known = useMemo(() => new Set(videos.map((v) => v.ytId)), [videos]);
  const shown = useMemo(() => items
    .filter((v) => !hidden.includes(v.ytId) && !known.has(v.ytId) && v.dur >= MIN_LEN && (topic === 'all' || tabOf(v.topic) === topic))
    .sort((a, b) => b.at - a.at).slice(0, 80), [items, hidden, known, topic]);
  const hide = (id: string) => { const n = [...hidden, id]; setHidden(n); try { localStorage.setItem(HIDE, JSON.stringify(n.slice(-800))); } catch { /* */ } };
  const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);
  const allFailed = !busy && items.length === 0 && failed.length > 0;

  return (
    <section className="en-feed-in">
      <div className="en-subbar">
        <span className="en-filter">{CTOPICS.map((t) => <button key={t.id} className={topic === t.id ? 'on' : ''} onClick={() => setTopic(t.id)}>{t.label}</button>)}</span>
        <button className="en-link" onClick={() => setManage((m) => !m)}>{manage ? 'Done' : `Channels (${channels.length})`}</button>
      </div>

      {manage && (
        <div className="card en-manage">
          <ul className="en-chips">
            {channels.map((c) => <li key={c.id}><span className={`en-dot ${tabOf(c.topic)}`} />{c.handle}<button onClick={() => removeChannel(c.id)} aria-label={`Remove ${c.handle}`}>×</button></li>)}
          </ul>
          <form className="en-chan-add" onSubmit={(e) => { e.preventDefault(); if (handle.trim()) { addChannel(handle, ctopic); setHandle(''); } }}>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle or youtube.com/@handle" aria-label="Channel handle" />
            <select value={ctopic} onChange={(e) => setCtopic(e.target.value as Channel['topic'])} aria-label="Topic">{CTOPICS.filter((t) => t.id !== 'all').map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
            <Button type="submit">Add channel</Button>
          </form>
        </div>
      )}

      {busy && done < channels.length && <p className="en-feed-note">Loading your channels… {done} of {channels.length}</p>}
      {allFailed && <p className="en-empty">Could not reach any mirror server. They are run by volunteers and are sometimes down. <button className="en-link" onClick={() => refresh(true)}>Try again</button></p>}
      {!busy && failed.length > 0 && !allFailed && <p className="en-feed-note">Could not load: {failed.join(', ')}. <button className="en-link" onClick={retryFailed}>Retry</button></p>}
      {!busy && items.length > 0 && shown.length === 0 && <p className="en-empty">Nothing new in this topic.</p>}

      <ul className="en-feed-list">
        {shown.map((i) => (
          <li className="en-card" key={i.ytId}>
            <button className="en-thumb" onClick={() => onPlay(i.ytId, i.title)} aria-label={`Play ${i.title}`}>
              <img src={`https://i.ytimg.com/vi/${i.ytId}/mqdefault.jpg`} alt="" loading="lazy" /><span className="en-play" aria-hidden>▶</span>
              <span className="en-dur">{mins(i.dur)}</span>
            </button>
            <div className="en-card-body">
              <div className="en-title">{i.title}</div>
              <div className="en-feed-meta">{i.channel} · {ago(i.at)}</div>
              <div className="en-actions en-card-act">
                <Button variant="ghost" onClick={() => onPlay(i.ytId, i.title)}>Watch</Button>
                <Button variant="text" onClick={() => addVideo(i.ytId, i.title, 'learn')}>Save for later</Button>
                <Button variant="text" onClick={() => hide(i.ytId)}>Not for me</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!busy && items.length > 0 && <p className="en-feed-end"><button className="en-link" onClick={() => refresh(true)}>Refresh</button></p>}
    </section>
  );
}

/** The Entertainment feed: HackerTube's curated library, and your own YouTube channels. */
export default function Feed({ onPlay }: { onPlay: (ytId: string, title: string) => void }) {
  const [src, setSrcState] = useState<'ht' | 'mine'>(() => (location.hash === '#mine' ? 'mine' : localStorage.getItem('ledger-feed-tab') === 'mine' ? 'mine' : 'ht'));
  const setSrc = (v: 'ht' | 'mine') => { setSrcState(v); try { localStorage.setItem('ledger-feed-tab', v); } catch { /* */ } };
  return (
    <section className="en-feed">
      <SectionHeader label="Your feed" right={<span className="en-filter">
        <button className={src === 'ht' ? 'on' : ''} onClick={() => setSrc('ht')}>HackerTube</button>
        <button className={src === 'mine' ? 'on' : ''} onClick={() => setSrc('mine')}>My YouTube</button>
      </span>} />
      {src === 'ht' ? <HackerTubeTab onPlay={onPlay} /> : <ChannelFeed onPlay={onPlay} />}
    </section>
  );
}
