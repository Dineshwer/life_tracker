import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../../store';
import { Button } from '../../components/ui';
import { TOPICS, FIN_SUBS, type ChannelView, type ChannelPlaylist, type PlaylistData } from '../contract';
import { channelId, channelVideos, type MirrorVideo } from '../../lib/mirror';
import { channelPlaylists, playlistVideos, playlistUrl } from '../../lib/yt';
import { usePlayer } from '../ui/player';
import { VideoRow } from './VideoRow';
import { MIN_LEN, ago, ytChannelUrl } from './util';

const topicLabel = (c: ChannelView) => (TOPICS.find((t) => t.id === c.topic)?.label ?? '') + (c.sub ? ` · ${FIN_SUBS.find((s) => s.id === c.sub)?.label}` : '');
const vidCache = new Map<string, MirrorVideo[]>(); // per session, so flipping between channels does not refetch

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return <span className="ch-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{(name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase()}</span>;
}

function MirrorDown({ handle, onRetry, what }: { handle: string; onRetry: () => void; what: string }) {
  return (
    <div className="ch-note ch-down" role="alert">
      <strong>Mirror servers are down right now</strong>
      <span>Could not load {what}. They are run by volunteers and often come back in a minute.</span>
      <div className="ch-row">
        <Button variant="ghost" onClick={onRetry}>Try again</Button>
        <a className="btn btn-text" href={ytChannelUrl(handle)} target="_blank" rel="noreferrer noopener">Open the channel on YouTube</a>
      </div>
    </div>
  );
}

/** The channel page: header, latest videos and playlists, all loaded on demand for this one channel. Tapping a playlist lists its lectures inline. */
export default function ChannelPage({ channel, onBack, backLabel, actions }: { channel: ChannelView; onBack?: () => void; backLabel?: string; actions: ReactNode }) {
  const { play } = usePlayer();
  const videos = useStore((s) => s.videos);
  const addVideo = useStore((s) => s.addVideo);
  const saved = useMemo(() => new Set(videos.map((v) => v.ytId)), [videos]);
  const watched = useMemo(() => new Set(videos.filter((v) => v.watchedAt).map((v) => v.ytId)), [videos]);

  const [cid, setCid] = useState<string | undefined>(channel.cid);
  const [vids, setVids] = useState<MirrorVideo[] | null>(null);
  const [vErr, setVErr] = useState(false);
  const [pls, setPls] = useState<ChannelPlaylist[] | null>(null);
  const [pErr, setPErr] = useState(false);
  const [open, setOpen] = useState<ChannelPlaylist | null>(null);
  const [lec, setLec] = useState<PlaylistData | null>(null);
  const [lErr, setLErr] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setVids(null); setPls(null); setVErr(false); setPErr(false); setOpen(null); setCid(channel.cid);
    (async () => {
      let id: string | null = null;
      try { id = await channelId(channel.handle, channel.cid); } catch { /* handled below */ }
      if (!live) return;
      if (!id) { setVErr(true); setPErr(true); return; }
      setCid(id);
      const cached = vidCache.get(id);
      if (cached) setVids(cached);
      else channelVideos(id).then((v) => { vidCache.set(id!, v); if (live) setVids(v); }).catch(() => { if (live) setVErr(true); });
      channelPlaylists(id).then((p) => { if (live) setPls(p); }).catch(() => { if (live) setPErr(true); });
    })();
    return () => { live = false; };
  }, [channel.id, channel.handle, channel.cid, tick]);

  const openPlaylist = useCallback((p: ChannelPlaylist) => {
    setOpen(p); setLec(null); setLErr(false);
    playlistVideos(p.id).then(setLec).catch(() => setLErr(true));
  }, []);

  const latest = (vids ?? []).filter((v) => v.dur >= MIN_LEN).sort((a, b) => b.at - a.at).slice(0, 30);
  const retry = () => setTick((t) => t + 1);

  return (
    <section className="ch-page" aria-label={`${channel.name} channel`}>
      {onBack && <button type="button" className="ch-back" onClick={onBack}>← {backLabel ?? 'Back'}</button>}
      <header className="ch-head">
        <Avatar name={channel.name} size={48} />
        <div className="ch-headtxt">
          <h3 className="ch-name">{channel.name}</h3>
          <div className="ch-sub">{topicLabel(channel)} · <a href={ytChannelUrl(channel.handle)} target="_blank" rel="noreferrer noopener">{channel.handle}</a></div>
        </div>
      </header>
      {channel.about && <p className="ch-about">{channel.about}</p>}
      <div className="ch-row ch-headact">{actions}</div>

      {open ? (
        <div>
          <button type="button" className="ch-back" onClick={() => setOpen(null)}>← Back to {channel.name}</button>
          <h4 className="ch-label">{open.title}</h4>
          {!lec && !lErr && <p className="ch-note" role="status">Loading lectures…</p>}
          {lErr && (
            <div className="ch-note ch-down" role="alert">
              <strong>Mirror servers are down right now</strong>
              <div className="ch-row"><Button variant="ghost" onClick={() => openPlaylist(open)}>Try again</Button><a className="btn btn-text" href={playlistUrl(open.id)} target="_blank" rel="noreferrer noopener">Open the playlist on YouTube</a></div>
            </div>
          )}
          {lec && (
            <ul className="ch-list">
              {lec.videos.map((v, i) => (
                <VideoRow key={v.ytId} ytId={v.ytId} title={v.title} dur={v.dur} done={watched.has(v.ytId)} meta={`Lecture ${i + 1}${watched.has(v.ytId) ? ' · watched' : ''}`} onPlay={() => play({ ytId: v.ytId, title: v.title, playlistId: open.id })} />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <h4 className="ch-label">Latest videos</h4>
          {vErr && <MirrorDown handle={channel.handle} onRetry={retry} what="this channel's videos" />}
          {!vErr && !vids && <p className="ch-note" role="status">Loading latest videos…</p>}
          {vids && latest.length === 0 && <p className="ch-note">No recent videos found.</p>}
          <ul className="ch-list">
            {latest.map((v) => (
              <VideoRow key={v.ytId} ytId={v.ytId} title={v.title} dur={v.dur} meta={ago(v.at)} onPlay={() => play({ ytId: v.ytId, title: v.title })}>
                <Button onClick={() => play({ ytId: v.ytId, title: v.title })}>Play</Button>
                {saved.has(v.ytId) ? <span className="ch-saved">Saved</span> : <Button variant="ghost" onClick={() => addVideo(v.ytId, v.title, 'learn')}>Save for later</Button>}
              </VideoRow>
            ))}
          </ul>

          <h4 className="ch-label">Playlists</h4>
          {pErr && !vErr && <p className="ch-note">Could not load playlists. <button type="button" className="ch-link" onClick={retry}>Try again</button></p>}
          {!pErr && !pls && cid !== undefined && <p className="ch-note" role="status">Loading playlists…</p>}
          {pls && pls.length === 0 && <p className="ch-note">This channel has no public playlists.</p>}
          <ul className="ch-list ch-pls">
            {(pls ?? []).map((p) => (
              <li key={p.id}>
                <button type="button" className="ch-pl" onClick={() => openPlaylist(p)}>
                  <span className="ch-pltitle">{p.title}</span>
                  <span className="ch-plmeta">{p.count ? `${p.count} videos` : 'Playlist'}</span>
                  <span aria-hidden className="ch-chev">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
