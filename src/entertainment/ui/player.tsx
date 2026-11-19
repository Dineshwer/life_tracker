import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../../store';
import { Button } from '../../components/ui';
import { mirrorBase } from '../../lib/mirror';

export interface PlayItem { ytId: string; title: string; /** set when playing a lecture so the embed continues the playlist */ playlistId?: string }
interface Ctx { play: (item: PlayItem) => void; current: PlayItem | null }
const PlayerCtx = createContext<Ctx>({ play: () => {}, current: null });
export const usePlayer = () => useContext(PlayerCtx);

/** One in-app player for the whole Entertainment page. Rendered once by the shell at the top; any tab calls usePlayer().play(). */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<PlayItem | null>(null);
  const logWatched = useStore((s) => s.logWatched);
  const value = useMemo<Ctx>(() => ({ current, play: (item) => { setCurrent(item); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* */ } } }), [current]);
  const src = current && `https://www.youtube-nocookie.com/embed/${current.ytId}?rel=0&autoplay=1${current.playlistId ? `&list=${encodeURIComponent(current.playlistId)}` : ''}`;
  return (
    <PlayerCtx.Provider value={value}>
      {current && (
        <section className="en-player card" aria-label="Player">
          <div className="en-frame"><iframe src={src!} title={current.title} allow="accelerometer; autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen /></div>
          <div className="en-player-bar">
            <div className="en-title">{current.title}</div>
            <div className="en-actions">
              <Button onClick={() => { logWatched(current.ytId, current.title); setCurrent(null); }}>Mark watched</Button>
              <a className="btn btn-ghost" href={`${mirrorBase()}/watch?v=${current.ytId}`} target="_blank" rel="noreferrer noopener">Open ad-free</a>
              <Button variant="ghost" onClick={() => setCurrent(null)}>Close</Button>
            </div>
          </div>
        </section>
      )}
      {children}
    </PlayerCtx.Provider>
  );
}
