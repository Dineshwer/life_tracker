import { useEffect, useMemo, useState } from 'react';
import { useCourses } from '../state';
import { TopicChips, Segmented } from '../ui/Chips';
import { usePlayer } from '../ui/player';
import { playlistVideos } from '../../lib/yt';
import type { CourseView, FinSub, TopicId } from '../contract';
import { TOPICS } from '../contract';
import { CourseCard } from './CourseCard';
import { CoursePage } from './CoursePage';
import { AddPlaylist } from './AddPlaylist';
import './courses.css';

type Which = 'mine' | 'suggested';

export default function CoursesTab() {
  const api = useCourses();
  const { play } = usePlayer();
  const [which, setWhich] = useState<Which>('mine');
  const [topic, setTopic] = useState<TopicId | 'all'>('all');
  const [sub, setSub] = useState<FinSub | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const list = which === 'mine' ? api.mine : api.suggested;
  const available = useMemo(() => [...new Set(list.map((c) => c.topic))], [list]);
  const eff: TopicId | 'all' = topic === 'all' || available.includes(topic) ? topic : 'all';
  const shown = useMemo(() => list.filter((c) => (eff === 'all' || c.topic === eff) && (eff !== 'fin' || sub === 'all' || c.sub === sub)), [list, eff, sub]);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [openId]);

  const open = openId ? [...api.mine, ...api.suggested].find((c) => c.id === openId) : undefined;
  if (open) return <div className="cr"><CoursePage course={open} onBack={() => setOpenId(null)} /></div>;

  // play a lecture of a course from its card: needs the lecture's id, so use the cached/loaded playlist
  const playIndex = async (c: CourseView, i: number) => {
    try {
      const d = await playlistVideos(c.id);
      const v = d.videos[i]; if (v) play({ ytId: v.ytId, title: v.title, playlistId: c.id });
    } catch { setOpenId(c.id); }
  };
  const label = TOPICS.find((t) => t.id === eff)?.label;

  return (
    <div className="cr">
      <Segmented<Which> label="Courses list" value={which} onChange={(w) => { setWhich(w); setAdding(false); }} options={[{ id: 'mine', label: 'Mine', count: api.mine.length }, { id: 'suggested', label: 'Suggested', count: api.suggested.length }]} />
      {available.length > 1 && <TopicChips value={eff} onChange={(t) => { setTopic(t); setSub('all'); }} available={available} sub={sub} onSub={setSub} />}

      {which === 'mine' && (adding
        ? <AddPlaylist onCancel={() => setAdding(false)} onAdd={(u, t, tp, sb) => { const id = api.addCustom(u, t, tp, sb); if (!id) return false; setAdding(false); setTopic('all'); return true; }} />
        : <button type="button" className="btn btn-ghost cr-addbtn" onClick={() => setAdding(true)}>+ Add a playlist</button>)}

      {shown.length === 0 ? (
        <div className="cr-empty card">
          {list.length === 0
            ? (which === 'mine'
              ? <><p>No courses yet.</p><p className="cr-note">Add one from Suggested, or paste a playlist link.</p><button type="button" className="btn btn-solid cr-primary" onClick={() => setWhich('suggested')}>See suggested</button></>
              : <><p>No more suggestions.</p><p className="cr-note">{api.dismissedCount ? 'Restore the ones you dismissed below.' : 'You have added them all.'}</p></>)
            : <><p>{label ? `No ${label} courses here.` : 'Nothing here.'}</p><button type="button" className="btn btn-ghost cr-primary" onClick={() => { setTopic('all'); setSub('all'); }}>Show all topics</button></>}
        </div>
      ) : (
        <div className="cr-list">
          {shown.map((c) => (
            <CourseCard key={c.id} course={c}
              onOpen={() => setOpenId(c.id)} onContinue={(i) => void playIndex(c, i)}
              onAdd={() => api.addToMine(c.id)} onRemove={() => api.removeFromMine(c.id)} onDismiss={() => api.dismiss(c.id)} />
          ))}
        </div>
      )}

      {which === 'suggested' && api.dismissedCount > 0 && (
        <button type="button" className="btn btn-text cr-restore" onClick={() => api.restoreDismissed()}>Restore dismissed ({api.dismissedCount})</button>
      )}
    </div>
  );
}
