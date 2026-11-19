import { memo, useCallback, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { embedPlaylistUrl, playlistUrl, thumb } from '../../lib/yt';
import { courseProgress, watchedIds } from '../state';
import { usePlayer } from '../ui/player';
import type { CourseView, PlVideo } from '../contract';
import { usePlaylist } from './usePlaylist';
import { Thumbnail } from './Thumbnail';
import { topicLabel } from './CourseCard';

const fmt = (s: number) => {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

const Row = memo(function Row({ v, n, done, onPlay, onToggle }: { v: PlVideo; n: number; done: boolean; onPlay: (v: PlVideo) => void; onToggle: (v: PlVideo, done: boolean) => void }) {
  return (
    <li className={`cr-lec ${done ? 'cr-done' : ''}`} data-testid="lecture" data-yt={v.ytId} data-done={done ? '1' : '0'}>
      <button type="button" className="cr-lec-play" onClick={() => onPlay(v)} aria-label={`Play lecture ${n}: ${v.title}`}>
        <Thumbnail src={thumb(v.ytId)} done={done} className="cr-thumb-sm" />
        <span className="cr-lec-text">
          <span className="cr-lec-title"><span className="cr-lec-n">{n}</span> {v.title}</span>
          {v.dur > 0 && <span className="cr-lec-dur">{fmt(v.dur)}</span>}
        </span>
      </button>
      <button type="button" className={`cr-tick ${done ? 'on' : ''}`} aria-pressed={done} aria-label={done ? `Mark lecture ${n} unwatched` : `Mark lecture ${n} watched`} onClick={() => onToggle(v, done)}>✓</button>
    </li>
  );
});

export function CoursePage({ course: c, onBack }: { course: CourseView; onBack: () => void }) {
  const pl = usePlaylist(c.id);
  const videos = useStore((s) => s.videos);
  const { play } = usePlayer();
  const [inApp, setInApp] = useState(false);
  const vids = pl.data?.videos;
  const prog = useMemo(() => (vids ? courseProgress(vids.map((v) => v.ytId), videos) : null), [vids, videos]);
  const done = useMemo(() => watchedIds(videos), [videos]);

  const playV = useCallback((v: PlVideo) => play({ ytId: v.ytId, title: v.title, playlistId: c.id }), [play, c.id]);
  const toggle = useCallback((v: PlVideo, wasDone: boolean) => {
    const st = useStore.getState();
    if (!wasDone) { st.logWatched(v.ytId, v.title); return; }
    for (const x of st.videos) if (x.ytId === v.ytId && x.watchedAt) st.setVideoWatched(x.id, false);
  }, []);
  const total = prog?.total ?? c.count ?? 0;
  const pct = prog && prog.total ? prog.done / prog.total : 0;
  const next = prog && prog.nextIndex >= 0 ? vids![prog.nextIndex] : null;

  return (
    <section className="cr-page" aria-label={c.title}>
      <button type="button" className="btn btn-text cr-back" onClick={onBack}>‹ Courses</button>
      <h2 className="display cr-page-title">{c.title}</h2>
      <div className="cr-meta">{[c.by, topicLabel(c), total ? `${total} lectures` : ''].filter(Boolean).join(' · ')}</div>
      {prog && (
        <div className="cr-prog">
          <div className="cr-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}><i style={{ width: `${pct * 100}%` }} /></div>
          <div className="cr-status">{prog.done} of {prog.total} watched</div>
        </div>
      )}
      {next && <button type="button" className="btn btn-solid cr-primary cr-wide" onClick={() => playV(next)}>{prog!.done > 0 ? `Continue · #${prog!.nextIndex + 1}` : 'Start'}</button>}
      {prog && !next && prog.total > 0 && <p className="cr-note">All lectures watched. Tap any lecture to watch again.</p>}

      {pl.status !== 'ok' && pl.status !== 'error' && (
        <ul className="cr-lecs" aria-busy="true" aria-label="Loading lectures">
          {Array.from({ length: 6 }, (_, i) => <li key={i} className="cr-lec cr-skel"><span className="cr-thumb cr-thumb-sm" /><span className="cr-skel-lines"><i /><i /></span></li>)}
        </ul>
      )}
      {pl.status === 'error' && (
        <div className="cr-fail card" role="alert">
          <h3 className="cr-form-title">Could not load the lecture list</h3>
          <p className="cr-note">You can still watch it on YouTube.</p>
          <div className="cr-fail-actions">
            <a className="btn btn-solid cr-primary" href={playlistUrl(c.id)} target="_blank" rel="noreferrer noopener">Play on YouTube</a>
            <button type="button" className="btn btn-ghost cr-primary" onClick={() => setInApp((x) => !x)}>Play inside the app</button>
            <button type="button" className="btn btn-text cr-quiet" onClick={pl.retry}>Retry</button>
          </div>
          {inApp && <div className="cr-embed"><iframe src={embedPlaylistUrl(c.id)} title={c.title} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen /></div>}
        </div>
      )}
      {vids && (
        <ol className="cr-lecs">
          {vids.map((v, i) => <Row key={v.ytId} v={v} n={i + 1} done={done.has(v.ytId)} onPlay={playV} onToggle={toggle} />)}
        </ol>
      )}
    </section>
  );
}
