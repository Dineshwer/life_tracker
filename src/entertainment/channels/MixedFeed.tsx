import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Button } from '../../components/ui';
import type { ChannelView } from '../contract';
import { usePlayer } from '../ui/player';
import { useChannelFeed } from './useChannelFeed';
import { VideoRow } from './VideoRow';
import { MIN_LEN, ago, readHidden, writeHidden, ytChannelUrl } from './util';

/** The combined newest-first feed of my channels (already filtered to the topic chip by `visible`). */
export default function MixedFeed({ channels, visible }: { channels: ChannelView[]; visible: (c: ChannelView) => boolean }) {
  const { play } = usePlayer();
  const videos = useStore((s) => s.videos);
  const addVideo = useStore((s) => s.addVideo);
  const feed = useChannelFeed(channels);
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const known = useMemo(() => new Set(videos.map((v) => v.ytId)), [videos]);
  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const shown = useMemo(() => feed.items
    .filter((v) => { const c = byId.get(v.h); return c && visible(c) && !hidden.includes(v.ytId) && !known.has(v.ytId) && v.dur >= MIN_LEN; })
    .sort((a, b) => b.at - a.at)
    .filter((v, i, all) => all.findIndex((x) => x.ytId === v.ytId) === i) // collabs appear on several channels
    .slice(0, 80), [feed.items, byId, visible, hidden, known]);
  const hide = (id: string) => { const n = [...hidden, id]; setHidden(n); writeHidden(n); };
  const failedChannels = feed.failed.map((id) => byId.get(id)).filter((c): c is ChannelView => !!c);
  const allFailed = !feed.busy && feed.items.length === 0 && failedChannels.length > 0;

  if (!channels.length) return <p className="ch-empty">No channels yet. Add some from Suggested, or add your own below.</p>;
  return (
    <div>
      {feed.busy && <p className="ch-note" role="status">Loading your channels… {feed.done} of {feed.total}</p>}
      {allFailed && (
        <div className="ch-note ch-down" role="alert">
          <strong>Mirror servers are down right now</strong>
          <span>They are run by volunteers and are sometimes down. Nothing is lost.</span>
          <div className="ch-row"><Button variant="ghost" onClick={() => feed.refresh(true)}>Try again</Button><a className="btn btn-text" href={ytChannelUrl(failedChannels[0].handle)} target="_blank" rel="noreferrer noopener">Open the channel on YouTube</a></div>
        </div>
      )}
      {!feed.busy && failedChannels.length > 0 && !allFailed && (
        <div className="ch-note" role="status">
          <span>Could not load {failedChannels.length} channel{failedChannels.length > 1 ? 's' : ''}:</span>
          <ul className="ch-failed">{failedChannels.map((c) => <li key={c.id}>{c.name}</li>)}</ul>
          <Button variant="ghost" onClick={feed.retryFailed}>Retry</Button>
        </div>
      )}
      {!feed.busy && feed.items.length > 0 && shown.length === 0 && <p className="ch-empty">Nothing new in this topic.</p>}
      <ul className="ch-list" aria-label="Latest videos from your channels">
        {shown.map((v) => (
          <VideoRow key={v.ytId} ytId={v.ytId} title={v.title} dur={v.dur} meta={`${v.channel} · ${ago(v.at)}`} onPlay={() => play({ ytId: v.ytId, title: v.title })}>
            <Button onClick={() => play({ ytId: v.ytId, title: v.title })}>Play</Button>
            <Button variant="ghost" onClick={() => addVideo(v.ytId, v.title, 'learn')}>Save for later</Button>
            <Button variant="text" onClick={() => hide(v.ytId)}>Not interested</Button>
          </VideoRow>
        ))}
      </ul>
      {!feed.busy && feed.items.length > 0 && <p className="ch-end"><button type="button" className="ch-link" onClick={() => feed.refresh(true)}>Refresh</button></p>}
    </div>
  );
}
