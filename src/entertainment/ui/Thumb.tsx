import { useState } from 'react';
import { thumb } from '../../lib/yt';

/** Video thumbnail with a play overlay. Falls back to a neutral block if the image fails (offline). */
export function Thumb({ ytId, title, onPlay, size = 'mq', done }: { ytId: string; title: string; onPlay?: () => void; size?: 'mq' | 'hq'; done?: boolean }) {
  const [bad, setBad] = useState(false);
  const inner = (
    <>
      {!bad && <img src={thumb(ytId, size)} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />}
      {onPlay && <span className="en-play" aria-hidden>▶</span>}
      {done && <span className="en-done-badge" aria-hidden>✓</span>}
    </>
  );
  return onPlay
    ? <button type="button" className="en-thumb" onClick={onPlay} aria-label={`Play ${title}`}>{inner}</button>
    : <span className="en-thumb">{inner}</span>;
}
