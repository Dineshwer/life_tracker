import { useEffect, useState } from 'react';
import { Sheet } from '../../components/ui';

export interface Demo { name: string; gif?: string; steps?: string[]; muscles?: string[]; yt?: string | null; ytTitle?: string; ytChannel?: string }
type Manifest = Record<string, Demo>;

let cache: Manifest | null = null; let pending: Promise<Manifest> | null = null;
const url = (p: string) => `${import.meta.env.BASE_URL}${p}`.replace(/\/\//g, '/');
function load(): Promise<Manifest> {
  if (cache) return Promise.resolve(cache);
  pending ??= fetch(url('demos/manifest.json')).then((r) => r.json()).then((m: Manifest) => (cache = m)).catch(() => (cache = {}));
  return pending;
}
export function useDemos(): Manifest {
  const [m, setM] = useState<Manifest>(cache ?? {});
  useEffect(() => { let on = true; load().then((x) => { if (on) setM(x); }); return () => { on = false; }; }, []);
  return m;
}
export const gifUrl = (d: Demo) => (d.gif ? url(d.gif) : '');

const norm = (s: string) => s.trim().toLowerCase();
/** Find a demo key for a free-typed exercise name (exact name match, then loose contains). */
export function findDemoKey(m: Manifest, name: string): string | null {
  const n = norm(name); if (!n) return null;
  const keys = Object.keys(m);
  return keys.find((k) => norm(m[k].name) === n) ?? keys.find((k) => norm(m[k].name).includes(n) || n.includes(norm(m[k].name))) ?? null;
}

/** Small animated form thumbnail. Tap to open the full demo. Falls back to a play badge for video-only demos. */
export function DemoThumb({ k, onOpen, size = 56 }: { k?: string; onOpen: (k: string) => void; size?: number }) {
  const m = useDemos(); const d = k ? m[k] : undefined;
  if (!k || !d) return null;
  return (
    <button type="button" className="demo-thumb" style={{ width: size, height: size }} onClick={() => onOpen(k)} aria-label={`Show form: ${d.name}`}>
      {d.gif ? <img src={gifUrl(d)} alt="" loading="lazy" /> : <span className="demo-play" aria-hidden>▶</span>}
    </button>
  );
}

/** Full demo: animated GIF with steps, and a tutorial video when there is one. */
export function DemoSheet({ k, onClose }: { k: string | null; onClose: () => void }) {
  const m = useDemos(); const d = k ? m[k] : undefined;
  const [video, setVideo] = useState(false);
  useEffect(() => { setVideo(false); }, [k]);
  return (
    <Sheet open={!!k && !!d} onClose={onClose} title={d?.name ?? 'Form'}>
      {d && (
        <div className="demo-body">
          {d.gif && <img className="demo-gif" src={gifUrl(d)} alt={`${d.name} form, two positions`} />}
          {d.muscles && d.muscles.length > 0 && <div className="label">Works: {d.muscles.join(', ')}</div>}
          {d.steps && d.steps.length > 0 && <ol className="demo-steps">{d.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {d.yt && (video
            ? <div className="demo-video"><iframe src={`https://www.youtube-nocookie.com/embed/${d.yt}?rel=0&autoplay=1`} title={d.ytTitle ?? d.name} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
            : <button type="button" className="gym-btn gym-btn-ghost" onClick={() => setVideo(true)}>Watch tutorial{d.ytChannel ? ` · ${d.ytChannel}` : ''}</button>)}
          {d.yt && d.ytTitle && <div className="demo-cap">{d.ytTitle}</div>}
          {!d.gif && !d.yt && <p className="gym-muted">No demo found yet for this one.</p>}
        </div>
      )}
    </Sheet>
  );
}
