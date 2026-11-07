import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Button, SectionHeader } from '../../components/ui';
import type { Channel } from '../../types';
import HackerTubeTab from './HackerTubeTab';

const HIDE = 'ledger-feed-hidden';
const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDE) || '[]'); } catch { return []; } };

/* ---- My channels: only the channels you picked, newest first ---------------------------------------------- */
type CV = { ytId: string; title: string; at: number; dur: number; channel: string; topic: Channel['topic'] };
const CTOPICS: { id: 'all' | Channel['topic']; label: string }[] = [{ id: 'all', label: 'Everything' }, { id: 'sec', label: 'Security' }, { id: 'code', label: 'Computing' }, { id: 'sci', label: 'Science & math' }];
const CCACHE = 'ledger-channels-v1';
const CTTL = 3 * 3600 * 1000;
const MIN_LONG = 8 * 60; // skip Shorts and quick clips: this feed is for long-form

async function loadChannels(chs: Channel[], force: boolean): Promise<{ videos: CV[]; failed: string[]; error?: string }> {
  const sig = chs.map((c) => c.handle).sort().join(',');
  if (!force) { try { const c = JSON.parse(localStorage.getItem(CCACHE) || 'null'); if (c && c.sig === sig && Date.now() - c.at < CTTL) return c.data; } catch { /* */ } }
  const r = await fetch(`/api/feed?handles=${encodeURIComponent(chs.map((c) => c.handle).join(','))}`);
  if (!r.ok) throw new Error('feed');
  const j = await r.json() as { error?: string; channels: { handle: string; name?: string; error?: string; videos: { ytId: string; title: string; at: number; dur: number }[] }[] };
  if (j.error === 'no_key') return { videos: [], failed: [], error: 'no_key' };
  const topicOf = new Map(chs.map((c) => [c.handle.toLowerCase(), c.topic]));
  const videos: CV[] = []; const failed: string[] = [];
  for (const c of j.channels) {
    if (c.error) { failed.push(c.handle); continue; }
    for (const v of c.videos) videos.push({ ...v, channel: c.name || c.handle, topic: topicOf.get(c.handle.toLowerCase()) ?? 'code' });
  }
  const data = { videos, failed, ...(j.error ? { error: j.error } : {}) };
  if (videos.length) { try { localStorage.setItem(CCACHE, JSON.stringify({ at: Date.now(), sig, data })); } catch { /* */ } }
  return data;
}

export function ChannelFeed({ onPlay }: { onPlay: (ytId: string, title: string) => void }) {
  const channels = useStore((s) => s.channels);
  const videos = useStore((s) => s.videos);
  const addVideo = useStore((s) => s.addVideo);
  const addChannel = useStore((s) => s.addChannel);
  const removeChannel = useStore((s) => s.removeChannel);
  const [data, setData] = useState<{ videos: CV[]; failed: string[]; error?: string } | null>(null);
  const [net, setNet] = useState(false);
  const [topic, setTopic] = useState<'all' | Channel['topic']>('all');
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [manage, setManage] = useState(false);
  const [handle, setHandle] = useState('');
  const [ctopic, setCtopic] = useState<Channel['topic']>('sec');
  const sig = channels.map((c) => c.handle).join(',');

  const refresh = useCallback((force = false) => {
    setNet(false); setData(null);
    if (!channels.length) { setData({ videos: [], failed: [] }); return; }
    loadChannels(channels, force).then(setData).catch(() => setNet(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => { refresh(); }, [refresh]);

  const known = useMemo(() => new Set(videos.map((v) => v.ytId)), [videos]);
  const shown = useMemo(() => (data?.videos ?? [])
    .filter((v) => !hidden.includes(v.ytId) && !known.has(v.ytId) && (v.dur === 0 || v.dur >= MIN_LONG) && (topic === 'all' || v.topic === topic))
    .sort((a, b) => b.at - a.at).slice(0, 60), [data, hidden, known, topic]);
  const hide = (id: string) => { const n = [...hidden, id]; setHidden(n); try { localStorage.setItem(HIDE, JSON.stringify(n.slice(-500))); } catch { /* */ } };
  const mins = (s: number) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');

  return (
    <section className="en-feed-in">
      <div className="en-subbar">
        <span className="en-filter">{CTOPICS.map((t) => <button key={t.id} className={topic === t.id ? 'on' : ''} onClick={() => setTopic(t.id)}>{t.label}</button>)}</span>
        <button className="en-link" onClick={() => setManage((m) => !m)}>{manage ? 'Done' : `Channels (${channels.length})`}</button>
      </div>

      {manage && (
        <div className="card en-manage">
          <ul className="en-chips">
            {channels.map((c) => <li key={c.id}><span className={`en-dot ${c.topic}`} />{c.handle}<button onClick={() => removeChannel(c.id)} aria-label={`Remove ${c.handle}`}>×</button></li>)}
          </ul>
          <form className="en-chan-add" onSubmit={(e) => { e.preventDefault(); if (handle.trim()) { addChannel(handle, ctopic); setHandle(''); } }}>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle or youtube.com/@handle" aria-label="Channel handle" />
            <select value={ctopic} onChange={(e) => setCtopic(e.target.value as Channel['topic'])} aria-label="Topic"><option value="sec">Security</option><option value="code">Computing</option><option value="sci">Science & math</option></select>
            <Button type="submit">Add channel</Button>
          </form>
        </div>
      )}

      {data?.error === 'no_key' && (
        <div className="card en-setup">
          <div className="label">One-time setup</div>
          <p>The channel feed needs a free YouTube API key, which stays on the server. Create one in Google Cloud (enable "YouTube Data API v3"), then set <code>YOUTUBE_API_KEY</code> in <code>.env.local</code> for the laptop and in the Vercel project settings for the phone. Steps are in the README.</p>
        </div>
      )}
      {data?.error === 'quota' && <p className="en-empty">Today's free YouTube quota is used up. The feed returns tomorrow.</p>}
      {net && <p className="en-empty">Could not reach the feed. Check your connection, then <button className="en-link" onClick={() => refresh(true)}>try again</button>.</p>}
      {!net && !data && <p className="en-empty">Loading your channels…</p>}
      {data && data.failed.length > 0 && <p className="en-feed-note">Could not find: {data.failed.join(', ')}. Check the handles in Channels.</p>}
      {data && !data.error && shown.length === 0 && !data.failed.length && <p className="en-empty">Nothing new from your channels. <button className="en-link" onClick={() => refresh(true)}>Refresh</button></p>}

      <ul className="en-feed-list">
        {shown.map((i) => (
          <li className="en-card" key={i.ytId}>
            <button className="en-thumb" onClick={() => onPlay(i.ytId, i.title)} aria-label={`Play ${i.title}`}>
              <img src={`https://i.ytimg.com/vi/${i.ytId}/mqdefault.jpg`} alt="" loading="lazy" /><span className="en-play" aria-hidden>▶</span>
              {i.dur > 0 && <span className="en-dur">{mins(i.dur)}</span>}
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
    </section>
  );
}

/** The Entertainment feed: HackerTube's curated library, and your own YouTube channels. */
export default function Feed({ onPlay }: { onPlay: (ytId: string, title: string) => void }) {
  const [src, setSrc] = useState<'ht' | 'mine'>('ht');
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
