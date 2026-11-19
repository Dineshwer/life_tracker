import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui';
import { TOPICS, FIN_SUBS, type ChannelView, type FinSub, type TopicId } from '../contract';
import { useChannels } from '../state';
import { Segmented, TopicChips } from '../ui/Chips';
import ChannelPage, { Avatar } from './ChannelPage';
import MixedFeed from './MixedFeed';
import { AddChannel } from './AddChannel';
import './channels.css';

type List = 'mine' | 'suggested';
type View = 'mixed' | 'one';
const topicName = (c: ChannelView) => (TOPICS.find((t) => t.id === c.topic)?.label ?? '') + (c.sub ? ` · ${FIN_SUBS.find((s) => s.id === c.sub)?.label}` : '');

export default function ChannelsTab() {
  const api = useChannels();
  const [list, setList] = useState<List>('mine');
  const [view, setView] = useState<View>('mixed');
  const [topic, setTopic] = useState<TopicId | 'all'>('all');
  const [sub, setSub] = useState<FinSub | 'all'>('all');
  const [oneId, setOneId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const source = list === 'mine' ? api.mine : api.suggested;
  const available = useMemo(() => [...new Set(source.map((c) => c.topic))], [source]);
  useEffect(() => { if (topic !== 'all' && !available.includes(topic)) { setTopic('all'); setSub('all'); } }, [available, topic]);
  const visible = useMemo(() => (c: ChannelView) => topic === 'all' || (c.topic === topic && (topic !== 'fin' || sub === 'all' || c.sub === sub)), [topic, sub]);
  const filtered = useMemo(() => source.filter(visible), [source, visible]);
  const existing = useMemo(() => new Set([...api.mine, ...api.suggested].map((c) => c.id)), [api.mine, api.suggested]);

  const one = filtered.find((c) => c.id === oneId) ?? filtered[0];
  const preview = previewId ? api.suggested.find((c) => c.id === previewId) ?? api.mine.find((c) => c.id === previewId) : undefined;
  const pick = (t: TopicId | 'all') => { setTopic(t); setSub('all'); };

  const mineActions = (c: ChannelView) => (
    <Button variant="ghost" onClick={() => { api.removeFromMine(c.id); setOneId(null); }}>Remove</Button>
  );

  // a previewed suggested channel replaces the list until Back
  if (preview) {
    const isMine = preview.list === 'mine';
    return (
      <div className="ch">
        <ChannelPage channel={preview} backLabel="Back to Suggested" onBack={() => setPreviewId(null)} actions={isMine
          ? <span className="ch-saved">In your channels</span>
          : <><Button onClick={() => { api.addToMine(preview.handle); setPreviewId(null); }}>+ Add to mine</Button><Button variant="text" onClick={() => { api.dismiss(preview.handle); setPreviewId(null); }}>Not interested</Button></>} />
      </div>
    );
  }

  return (
    <div className="ch">
      <Segmented<List> label="Channel list" value={list} onChange={(v) => { setList(v); }} options={[{ id: 'mine', label: 'Mine', count: api.mine.length }, { id: 'suggested', label: 'Suggested', count: api.suggested.length }]} />
      <TopicChips value={topic} onChange={pick} available={available} sub={sub} onSub={setSub} />

      {list === 'mine' && (
        <>
          <Segmented<View> label="Mine view" value={view} onChange={setView} options={[{ id: 'mixed', label: 'All mixed' }, { id: 'one', label: 'One channel' }]} />
          <div className="ch-gap" />
          {view === 'mixed' && <MixedFeed channels={api.mine} visible={visible} />}
          {view === 'one' && (filtered.length === 0
            ? <p className="ch-empty">{api.mine.length ? 'No channels in this topic.' : 'No channels yet. Add some from Suggested, or add your own below.'}</p>
            : (
              <>
                <div className="ch-strip" role="group" aria-label="Your channels">
                  {filtered.map((c) => <button key={c.id} type="button" className={c.id === one?.id ? 'on' : ''} aria-pressed={c.id === one?.id} onClick={() => setOneId(c.id)}>{c.name}</button>)}
                </div>
                {one && <ChannelPage key={one.id} channel={one} actions={mineActions(one)} />}
              </>
            ))}
        </>
      )}

      {list === 'suggested' && (
        <>
          <div className="ch-gap" />
          {filtered.length === 0 && <p className="ch-empty">{api.suggested.length ? 'No suggestions in this topic.' : 'No suggestions left.'}</p>}
          <ul className="ch-list">
            {filtered.map((c) => (
              <li key={c.id} className="card ch-card">
                <button type="button" className="ch-cardhead" onClick={() => setPreviewId(c.id)} aria-label={`Preview ${c.name}`}>
                  <Avatar name={c.name} />
                  <span className="ch-headtxt">
                    <span className="ch-name">{c.name}</span>
                    <span className="ch-sub">{topicName(c)}</span>
                  </span>
                  <span className="ch-prev">Preview ›</span>
                </button>
                {c.about && <p className="ch-about">{c.about}</p>}
                <div className="ch-row">
                  <Button onClick={() => api.addToMine(c.handle)}>+ Add to mine</Button>
                  <Button variant="text" onClick={() => api.dismiss(c.handle)}>Not interested</Button>
                </div>
              </li>
            ))}
          </ul>
          {api.dismissedCount > 0 && <p className="ch-end"><button type="button" className="ch-link" onClick={api.restoreDismissed}>Restore {api.dismissedCount} dismissed</button></p>}
        </>
      )}

      <AddChannel existing={existing} onAdd={(h, t, s) => { api.addCustom(h, t, s); setList('mine'); }} />
    </div>
  );
}
