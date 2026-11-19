import { useMemo } from 'react';
import { useStore } from '../../store';
import { TOPICS, FIN_SUBS, type CourseView } from '../contract';
import { courseProgress } from '../state';
import { thumb } from '../../lib/yt';
import { usePlaylist, useNear } from './usePlaylist';
import { Thumbnail } from './Thumbnail';

export const topicLabel = (c: CourseView) => {
  const t = TOPICS.find((x) => x.id === c.topic)?.label ?? '';
  const s = c.sub ? FIN_SUBS.find((x) => x.id === c.sub)?.label : '';
  return s ? `${t} · ${s}` : t;
};

interface Props {
  course: CourseView;
  onOpen: () => void;
  onContinue: (index: number) => void;
  onAdd: () => void; onRemove: () => void; onDismiss: () => void;
}

export function CourseCard({ course: c, onOpen, onContinue, onAdd, onRemove, onDismiss }: Props) {
  const mine = c.list === 'mine';
  const isLink = c.kind === 'link';
  const [ref, near] = useNear<HTMLElement>();
  const pl = usePlaylist(isLink ? null : c.id, mine || near);
  const videos = useStore((s) => s.videos);
  const vids = pl.data?.videos;
  const prog = useMemo(() => (vids ? courseProgress(vids.map((v) => v.ytId), videos) : null), [vids, videos]);
  const total = prog?.total ?? c.count ?? 0;
  const pct = prog && prog.total ? prog.done / prog.total : 0;
  const first = vids?.[0];

  let primary: React.ReactNode = null;
  if (mine) {
    if (isLink) primary = <a className="btn btn-solid cr-primary" href={c.url} target="_blank" rel="noreferrer noopener">Open course site</a>;
    else if (!prog) primary = <button type="button" className="btn btn-ghost cr-primary" onClick={onOpen}>Open</button>;
    else if (prog.nextIndex >= 0) {
      const started = prog.done > 0;
      primary = started
        ? <button type="button" className="btn btn-solid cr-primary" onClick={() => onContinue(prog.nextIndex)}>Continue · #{prog.nextIndex + 1}</button>
        : <button type="button" className="btn btn-ghost cr-primary" onClick={() => onContinue(0)}>Start</button>;
    } else primary = <button type="button" className="btn btn-ghost cr-primary" onClick={onOpen}>{prog.total ? 'Review' : 'Open'}</button>;
  } else primary = <button type="button" className="btn btn-solid cr-primary" onClick={onAdd}>+ Add to mine</button>;

  const status = mine && !isLink
    ? (prog ? (prog.done === 0 ? 'Not started' : `${prog.done} of ${prog.total} watched`) : pl.status === 'error' ? 'Lecture list unavailable' : 'Loading…')
    : null;

  const titleEl = mine && !isLink
    ? <button type="button" className="cr-title cr-title-btn" onClick={onOpen}>{c.title}</button>
    : <h3 className="cr-title">{c.title}</h3>;

  return (
    <article className="cr-card card" ref={ref} data-testid="course-card" data-course={c.id}>
      <div className="cr-top">
        <Thumbnail src={first ? thumb(first.ytId) : undefined} />
        <div className="cr-main">
          {titleEl}
          {c.by && <div className="cr-by">{c.by}</div>}
          <div className="cr-meta">{topicLabel(c)}{total ? ` · ${total} lectures` : ''}</div>
        </div>
      </div>
      {mine && !isLink && (
        <div className="cr-prog">
          <div className="cr-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}><i style={{ width: `${pct * 100}%` }} /></div>
          <div className="cr-status">{status}</div>
        </div>
      )}
      {!mine && isLink && <div className="cr-note">Opens on their website</div>}
      {!mine && c.about && <p className="cr-about">{c.about}</p>}
      <div className="cr-actions">
        {primary}
        {mine
          ? <button type="button" className="btn btn-text cr-quiet" onClick={onRemove} aria-label={`Remove ${c.title}`}>Remove</button>
          : <button type="button" className="btn btn-text cr-quiet" onClick={onDismiss} aria-label={`Not interested in ${c.title}`}>Not interested</button>}
      </div>
    </article>
  );
}
