/* Video loader for the Entertainment redesign: playlists, channel playlists, thumbnails, embed/link helpers.

   SOURCES (verified live 2026-11-19, see report): only public Invidious mirrors that advertise api+cors work from a browser.
   Right now that is a single instance (yt.chocolatemoo53.com), so reliability is modest (5-10 s per call, may vanish).
   Piped API instances (no CORS / redirects / down) and the youtube.com/playlist HTML (no Access-Control-Allow-Origin) do NOT work
   from a browser and are deliberately not used.

   SNAPSHOT: public/courses.json (npm run snapshot:playlists) holds every catalog playlist, so playlistVideos() answers from it instantly
   and only refreshes from the mirror in the background (onPlaylistUpdate). Playlists outside the snapshot use the strategy below.

   FALLBACK STRATEGY: playlistVideos() serves a fresh cache (12 h), else asks the mirrors, else serves a STALE cache, and only when
   nothing is cached throws YtError (code 'unreachable' | 'notfound' | 'bad'). The UI should catch it and offer "Play on YouTube":
   an iframe at embedPlaylistUrl(id, index?) (youtube-nocookie, allowed by frame-src) and a plain link playlistUrl(id).

   RATE LIMIT: at most 3 requests in flight (worker pool); each request is retried once (mirror.ts get() already rotates mirrors).
   Everything fetched is untrusted: strings are coerced/clamped, ids validated. */
import { bases, get } from './mirror';
import type { ChannelPlaylist, PlaylistData, PlVideo } from '../entertainment/contract';

export type YtErrorCode = 'unreachable' | 'notfound' | 'bad';
export class YtError extends Error {
  code: YtErrorCode;
  constructor(code: YtErrorCode, message: string) { super(message); this.name = 'YtError'; this.code = code; }
}

/* ---------- pure helpers ---------- */
export type ThumbSize = 'mq' | 'hq' | 'max';
const SIZE = { mq: 'mqdefault', hq: 'hqdefault', max: 'maxresdefault' } as const;
export const thumb = (ytId: string, size: ThumbSize = 'mq'): string => `https://i.ytimg.com/vi/${encodeURIComponent(ytId)}/${SIZE[size]}.jpg`;
export const playlistUrl = (id: string): string => `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
export const embedPlaylistUrl = (id: string, index?: number): string =>
  `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(id)}${index != null && index > 0 ? `&index=${Math.floor(index)}` : ''}`;

/* ---------- cache ---------- */
const TTL = 12 * 3600e3;
const key = (id: string) => `ledger-yt-pl:${id}`;
const readCache = (id: string): PlaylistData | null => { try { const v = localStorage.getItem(key(id)); return v ? JSON.parse(v) as PlaylistData : null; } catch { return null; } };
const writeCache = (d: PlaylistData) => { try { localStorage.setItem(key(d.id), JSON.stringify(d)); } catch { /* quota */ } };

/* ---------- limiter: max 3 in flight ---------- */
const MAX = 3; let active = 0; const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
const req = <T,>(path: string): Promise<T> => limited(async () => { try { return await get<T>(path); } catch { return await get<T>(path); } });

/* ---------- parsing ---------- */
const str = (v: unknown, max = 300): string => typeof v === 'string' ? v.slice(0, max) : '';
const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
const ID = /^[\w-]{11}$/;
interface RawVid { videoId?: unknown; title?: unknown; lengthSeconds?: unknown; index?: unknown; author?: unknown; liveNow?: unknown; isUpcoming?: unknown; premium?: unknown }
interface RawPl { title?: unknown; author?: unknown; videoCount?: unknown; videos?: unknown; error?: unknown }

/** Parse one playlist page. Drops live/upcoming/premium, private/deleted and malformed entries. `pos` is the fallback index. */
export function parseVideos(raw: unknown, base = 0): PlVideo[] {
  if (!Array.isArray(raw)) return [];
  const out: PlVideo[] = [];
  raw.forEach((x, i) => {
    const v = (x && typeof x === 'object' ? x : {}) as RawVid;
    const ytId = str(v.videoId, 20);
    if (!ID.test(ytId) || v.liveNow || v.isUpcoming || v.premium) return;
    const title = str(v.title).trim();
    if (!title || /^\[(private|deleted) video\]$/i.test(title)) return;
    const index = typeof v.index === 'number' && v.index >= 0 ? Math.floor(v.index) : base + i;
    const author = str(v.author, 100);
    out.push({ ytId, title, dur: num(v.lengthSeconds), index, ...(author ? { author } : {}) });
  });
  return out;
}

async function fetchPlaylist(id: string): Promise<PlaylistData> {
  const byId = new Map<string, PlVideo>(); let title = '', author = '', total = 0, partial = false;
  for (let page = 1; page <= 40; page++) {
    let j: RawPl;
    try { j = await req<RawPl>(`/api/v1/playlists/${encodeURIComponent(id)}?page=${page}`); }
    catch (e) { if (page === 1) throw e; partial = true; break; }
    if (j.error) { if (page === 1) throw new YtError('notfound', str(j.error, 100)); break; }
    title ||= str(j.title, 200); author ||= str(j.author, 100); total = num(j.videoCount) || total;
    const before = byId.size;
    const rawLen = Array.isArray(j.videos) ? j.videos.length : 0;
    for (const v of parseVideos(j.videos, (page - 1) * 100)) if (!byId.has(v.ytId)) byId.set(v.ytId, v);
    // mirrors overlap pages (page 2 can start at index 50) so stop on an empty/no-new page or once the count is reached
    if (rawLen === 0 || byId.size === before) break;
    const maxIdx = Math.max(...[...byId.values()].map((v) => v.index));
    if (total && maxIdx + 1 >= total) break;
    if (!total && rawLen < 100) break;
  }
  const videos = [...byId.values()].sort((a, b) => a.index - b.index);
  if (!videos.length) throw new YtError('bad', 'playlist has no playable videos');
  return { id, title, author, videos, fetchedAt: Date.now(), ...(partial ? { partial: true } : {}) };
}

/* ---------- bundled snapshot (public/courses.json, built by `npm run snapshot:playlists`) ---------- */
interface Snapshot { v: 1; at: number; playlists: Record<string, { title?: unknown; author?: unknown; videos?: unknown }> }
let snapP: Promise<Snapshot | null> | null = null;
let snapMeta: { at: number; count: number } | null = null;
/** Fetched once per session; resolves null (never rejects) when missing or malformed. */
function loadSnapshot(): Promise<Snapshot | null> {
  return snapP ??= (async () => {
    try {
      const r = await fetch('/courses.json', { cache: 'no-cache' });
      if (!r.ok) return null;
      const j = await r.json() as Partial<Snapshot> | null;
      if (!j || j.v !== 1 || typeof j.at !== 'number' || !j.playlists || typeof j.playlists !== 'object' || Array.isArray(j.playlists)) return null;
      snapMeta = { at: j.at, count: Object.keys(j.playlists).length };
      return j as Snapshot;
    } catch { return null; }
  })();
}
/** {at, count} of the loaded bundled snapshot (ms epoch, number of playlists), or null until it has loaded / when absent. */
export const snapshotInfo = (): { at: number; count: number } | null => snapMeta;

function fromSnapshot(s: Snapshot, id: string): PlaylistData | null {
  const e = Object.prototype.hasOwnProperty.call(s.playlists, id) ? s.playlists[id] : null;
  if (!e || !Array.isArray(e.videos)) return null;
  const videos: PlVideo[] = [];
  for (const t of e.videos) {
    if (!Array.isArray(t)) continue;
    const ytId = str(t[0], 20), title = str(t[1]).trim();
    if (!ID.test(ytId) || !title) continue;
    videos.push({ ytId, title, dur: num(t[2]), index: videos.length });
  }
  return videos.length ? { id, title: str(e.title, 200), author: str(e.author, 100), videos, fetchedAt: s.at } : null;
}

/* ---------- update notifications ---------- */
const subs = new Map<string, Set<(d: PlaylistData) => void>>();
/** Be told when a background refresh replaced a playlist you were served from the snapshot/cache. Returns the unsubscribe function. */
export function onPlaylistUpdate(id: string, cb: (d: PlaylistData) => void): () => void {
  let set = subs.get(id); if (!set) subs.set(id, set = new Set());
  set.add(cb);
  return () => { set!.delete(cb); };
}
const sameVideos = (a: PlaylistData, b: PlaylistData) => a.videos.length === b.videos.length && a.videos.every((v, i) => v.ytId === b.videos[i].ytId && v.title === b.videos[i].title && v.dur === b.videos[i].dur);

const refreshing = new Map<string, Promise<void>>();
/** Background refresh from the mirror: only a complete result is kept; failures are silent (the snapshot keeps serving). */
function refresh(id: string, shown: PlaylistData): void {
  if (refreshing.has(id)) return;
  const p = (async () => {
    try {
      const d = await fetchPlaylist(id);
      if (d.partial) return;
      writeCache(d);
      if (!sameVideos(d, shown)) for (const cb of [...(subs.get(id) ?? [])]) { try { cb(d); } catch { /* subscriber error */ } }
    } catch { /* mirror down: keep serving what we have */ }
  })().finally(() => { refreshing.delete(id); });
  refreshing.set(id, p);
}

/** All videos of a playlist, in order. Order: fresh cache (12 h) -> bundled snapshot (answers at once, refreshed from the mirror in the
 *  background, see onPlaylistUpdate) -> live mirror -> stale cache. Throws YtError only when snapshot, cache and mirror all lack it. */
export async function playlistVideos(playlistId: string): Promise<PlaylistData> {
  if (!/^[\w-]{2,64}$/.test(playlistId)) throw new YtError('bad', 'invalid playlist id');
  const c = readCache(playlistId);
  const cOk = !!c && Array.isArray(c.videos) && c.videos.length > 0;
  if (c && cOk && Date.now() - c.fetchedAt < TTL && !c.partial) return c;
  const snap = await loadSnapshot();
  const sd = snap ? fromSnapshot(snap, playlistId) : null;
  if (sd) {
    // a complete cache newer than the snapshot beats it (it came from the mirror after the snapshot was built)
    const shown = c && cOk && !c.partial && c.fetchedAt > sd.fetchedAt ? c : sd;
    refresh(playlistId, shown);
    return shown;
  }
  try {
    const d = await fetchPlaylist(playlistId); writeCache(d); return d;
  } catch (e) {
    if (c && cOk) return c;
    if (e instanceof YtError) throw e;
    throw new YtError('unreachable', `no mirror answered (${(await bases()).length} tried)`);
  }
}

/** A channel's public playlists. Cached 12 h with stale-on-error; returns [] only when the channel has none. */
export async function channelPlaylists(ucid: string): Promise<ChannelPlaylist[]> {
  if (!/^UC[\w-]{20,24}$/.test(ucid)) throw new YtError('bad', 'invalid channel id');
  const k = `ledger-yt-chpl:${ucid}`;
  let c: { at: number; list: ChannelPlaylist[] } | null = null;
  try { const v = localStorage.getItem(k); c = v ? JSON.parse(v) : null; } catch { /* */ }
  if (c && Date.now() - c.at < TTL) return c.list;
  try {
    const j = await req<{ playlists?: { playlistId?: unknown; title?: unknown; videoCount?: unknown }[] }>(`/api/v1/channels/${ucid}/playlists`);
    const list: ChannelPlaylist[] = [];
    for (const p of Array.isArray(j.playlists) ? j.playlists : []) {
      const id = str(p?.playlistId, 64), title = str(p?.title, 200).trim();
      if (id && title && /^[\w-]+$/.test(id)) list.push({ id, title, count: num(p.videoCount) });
    }
    try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), list })); } catch { /* */ }
    return list;
  } catch {
    if (c) return c.list;
    throw new YtError('unreachable', 'no mirror answered');
  }
}

/** Re-exports so callers needing channel feeds use one module. */
export { channelId, channelVideos, mirrorBase } from './mirror';
