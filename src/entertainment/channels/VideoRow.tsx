import type { ReactNode } from 'react';
import { Thumb } from '../ui/Thumb';
import { mins } from './util';

/** A video: real thumbnail (tap to play), title, meta line, and an action row passed as children. */
export function VideoRow({ ytId, title, meta, dur, done, onPlay, children }: { ytId: string; title: string; meta: ReactNode; dur?: number; done?: boolean; onPlay: () => void; children?: ReactNode }) {
  return (
    <li className="ch-vid">
      <div className="ch-vthumb">
        <Thumb ytId={ytId} title={title} onPlay={onPlay} done={done} />
        {!!dur && <span className="ch-dur">{mins(dur)}</span>}
      </div>
      <div className="ch-vbody">
        <div className="ch-vtitle">{title}</div>
        <div className="ch-vmeta">{meta}</div>
      </div>
      {children && <div className="ch-vact">{children}</div>}
    </li>
  );
}
