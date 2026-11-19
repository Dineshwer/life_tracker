import { useCallback, useEffect, useRef, useState } from 'react';
import { playlistVideos, YtError } from '../../lib/yt';
import { useStore } from '../../store';
import type { Course } from '../../types';
import type { PlaylistData } from '../contract';

/** The course row's stored lecture list as PlaylistData (null when the row has none). The synced `courses` row is the primary source. */
const fromRow = (c: Course | undefined): PlaylistData | null =>
  c?.videos?.length ? { id: c.id, title: c.title, author: c.by ?? '', videos: c.videos.map(([ytId, title, dur], index) => ({ ytId, title, dur, index })), fetchedAt: c.videosAt ?? 0 } : null;
const sameSet = (a: Course['videos'], b: PlaylistData['videos']) => !!a && a.length === b.length && a.every((v, i) => v[0] === b[i].ytId && v[1] === b[i].title && v[2] === b[i].dur);
/** Write a complete, fresher mirror result back into the course row. Only when the row exists, the list really differs and is newer. */
function writeBack(d: PlaylistData): void {
  if (d.partial || !d.videos.length) return;
  const row = useStore.getState().courses.find((c) => c.id === d.id);
  if (!row || sameSet(row.videos, d.videos) || d.fetchedAt <= (row.videosAt ?? 0)) return;
  useStore.getState().upsertCourse({ ...row, videos: d.videos.map((v) => [v.ytId, v.title, v.dur] as [string, string, number]), videosAt: d.fetchedAt });
}

/** In-memory copy so a card and its course page share one result within a session (yt.ts also caches in localStorage). */
const mem = new Map<string, PlaylistData>();
export type PlState = { status: 'idle' | 'loading' | 'ok' | 'error'; data?: PlaylistData; error?: YtError };

/** Loads a playlist without ever blocking rendering. `enabled=false` keeps it idle (used for off-screen cards). */
export function usePlaylist(id: string | null, enabled = true): PlState & { retry: () => void } {
  const row = useStore((s) => (id ? s.courses.find((c) => c.id === id) : undefined));
  const rowData = fromRow(row);
  const [st, setSt] = useState<PlState>(() => (rowData ? { status: 'ok', data: rowData } : id && mem.get(id) ? { status: 'ok', data: mem.get(id) } : { status: 'idle' }));
  // the stored list appears (or changes) after mount, e.g. when the cloud sync delivers it: show it at once
  useEffect(() => { if (rowData) setSt((s) => (s.data === rowData || s.data?.fetchedAt === rowData.fetchedAt && s.data.videos.length === rowData.videos.length ? s : { status: 'ok', data: rowData })); }, [row?.videos, row?.videosAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!id || !enabled) return;
    const cached = mem.get(id);
    if (cached && nonce === 0 && !rowData) { setSt({ status: 'ok', data: cached }); return; }
    const my = ++seq.current;
    setSt((s) => (rowData && nonce === 0 ? s : { status: 'loading', data: s.data }));
    playlistVideos(id).then(
      (d) => { mem.set(id, d); writeBack(d); if (my === seq.current && !rowData) setSt({ status: 'ok', data: d }); }, // with a stored list the row (updated by writeBack) drives the state
      (e) => { if (my === seq.current && !rowData) setSt({ status: 'error', error: e instanceof YtError ? e : new YtError('unreachable', String(e)) }); },
    );
    return () => { seq.current++; };
  }, [id, enabled, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...st, retry };
}

/** True once the element has come near the viewport (stays true). */
export function useNear<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}
