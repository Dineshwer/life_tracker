import { useStore } from '../store';
import { OLD_DEFAULT_CHANNEL_IDS } from '../seed';
import { CATALOG_VERSION, CHANNELS_ALL, COURSES_ALL, handleId } from './catalog';
import { mapTopic } from './state';
import { coerceItem } from '../lib/validate';
import type { Channel, Course, CourseVideo } from '../types';

/* The catalog (src/entertainment/catalog) is SEED ONLY. seedCatalog() copies it into the synced `channels` / `courses` collections once, after this
   device's first cloud sync, and never overwrites a row that exists (user choices win). From then on the database is the master. */

export const ENT_V2_FLAG = 'ent-v2';       // legacy: old default channels swapped
export const ENT_CATALOG_KEY = 'ent-catalog'; // integer: catalog version already seeded

/** May seeding act now? Without a cloud account (local mode) always; with one, only after this device finished its FIRST cloud sync
    (syncCache.ready), so a fresh device never writes (and then tombstones) what the server still has to deliver. */
export function entertainmentMigrationReady(cloud: boolean): boolean {
  return !cloud || !!useStore.getState().syncCache?.ready;
}

/** Shape of public/courses.json (the bundled snapshot). */
export interface CourseSnapshot { at?: number; playlists?: Record<string, { videos?: unknown[] }> }
let snapP: Promise<CourseSnapshot | null> | null = null;
/** Fetched once per session; any failure yields null (courses are then seeded without lectures; the page fills them in later). */
export function loadCourseSnapshot(): Promise<CourseSnapshot | null> {
  return (snapP ??= (async () => {
    try { const r = await fetch('/courses.json'); if (!r.ok) return null; const j = await r.json(); return j && typeof j === 'object' ? (j as CourseSnapshot) : null; } catch { return null; }
  })());
}
const videosOf = (snap: CourseSnapshot | null, id: string): { videos: CourseVideo[]; at: number } | null => {
  const e = snap?.playlists && Object.prototype.hasOwnProperty.call(snap.playlists, id) ? snap.playlists[id] : null;
  if (!e || !Array.isArray(e.videos)) return null;
  const videos: CourseVideo[] = [];
  for (const t of e.videos) if (Array.isArray(t) && typeof t[0] === 'string' && t[0] && typeof t[1] === 'string' && t[1].trim() && typeof t[2] === 'number' && Number.isFinite(t[2])) videos.push([t[0], t[1].trim(), Math.max(0, Math.round(t[2]))]);
  return videos.length && typeof snap?.at === 'number' ? { videos, at: snap.at } : null;
};

/** Pure core: the state patch that seeding produces (or null when there is nothing to do). */
export function planSeed(st: { channels: Channel[]; courses: Course[]; kv: { id: string; value: string }[] }, snap: CourseSnapshot | null): { channels: Channel[]; courses: Course[]; kv: { id: string; value: string }[] } | null {
  const kvv = new Map(st.kv.map((k) => [k.id, k.value]));
  const legacyKv = st.kv.filter((k) => /^(crs|chs|crsx):/.test(k.id));
  const needV2 = !kvv.has(ENT_V2_FLAG);
  const needCatalog = !(Number(kvv.get(ENT_CATALOG_KEY)) >= CATALOG_VERSION);
  if (!needV2 && !needCatalog && !legacyKv.length) return null;

  // 1. legacy: untouched old default channels are removed, user-added channels kept (legacy topics mapped)
  let channels = st.channels;
  if (needV2) { const old = new Set(OLD_DEFAULT_CHANNEL_IDS); channels = channels.filter((c) => !old.has(c.id)).map((c) => ({ ...c, topic: mapTopic(c.topic) })); }
  const chById = new Map(channels.map((c) => [c.id, c]));
  const courses = new Map(st.courses.map((c) => [c.id, c]));
  const addedCh: Channel[] = []; const addedCo: Course[] = [];

  // 2. catalog entries that have no row yet (match by id; picks -> mine, suggestions -> suggested)
  if (needCatalog) {
    for (const c of CHANNELS_ALL) {
      const id = handleId(c.handle); if (chById.has(id)) continue;
      const r: Channel = { id, handle: c.handle, ...(c.cid ? { cid: c.cid } : {}), topic: c.topic, ...(c.sub ? { sub: c.sub } : {}), name: c.name, ...(c.about ? { about: c.about } : {}), list: c.origin === 'pick' ? 'mine' : 'suggested', origin: c.origin };
      chById.set(id, r); addedCh.push(r);
    }
    for (const c of COURSES_ALL) {
      if (courses.has(c.id)) continue;
      const v = c.kind === 'playlist' ? videosOf(snap, c.id) : null;
      const r: Course = coerceItem('courses', { id: c.id, kind: c.kind, title: c.title, ...(c.by ? { by: c.by } : {}), topic: c.topic, ...(c.sub ? { sub: c.sub } : {}), list: (c.origin === 'pick' ? 'mine' : 'suggested') as Course['list'], origin: c.origin, ...(c.url ? { url: c.url } : {}), ...(c.count ? { count: c.count } : {}), ...(c.about ? { about: c.about } : {}), ...(v ? { videos: v.videos, videosAt: v.at } : {}) } as Course);
      courses.set(c.id, r); addedCo.push(r);
    }
  }

  // 3. kv rows of the first (unshipped) data model: fold into the rows, then delete them
  const changedCh = new Map<string, Channel>(); const changedCo = new Map<string, Course>();
  for (const k of legacyKv) {
    const [pre, ...rest] = k.id.split(':'); const key = rest.join(':');
    if (pre === 'crs') {
      const r = changedCo.get(key) ?? courses.get(key); if (!r) continue;
      const list: Course['list'] | null = k.value === 'mine' ? 'mine' : k.value === 'out' ? 'suggested' : k.value === 'hide' ? 'hidden' : null;
      if (list && r.list !== list) { const n: Course = { ...r, list }; changedCo.set(key, n); courses.set(key, n); }
    } else if (pre === 'chs') {
      const r = changedCh.get(key) ?? chById.get(key); if (!r || k.value !== 'hide' || r.list === 'hidden') continue;
      const n = { ...r, list: 'hidden' as const }; changedCh.set(key, n); chById.set(key, n);
    } else if (pre === 'crsx' && !courses.has(key)) {
      try {
        const o = JSON.parse(k.value);
        if (o && typeof o.title === 'string') { const r = coerceItem('courses', { id: key, kind: 'playlist', title: o.title.trim() || 'Untitled course', topic: mapTopic(o.topic), ...(o.sub ? { sub: o.sub } : {}), list: 'mine', origin: 'custom' } as Course); courses.set(key, r); addedCo.push(r); }
      } catch { /* unreadable row: just drop it */ }
    }
  }
  const applyCh = (c: Channel) => changedCh.get(c.id) ?? c;
  const outCh = [...channels, ...addedCh].map((c) => applyCh(chById.get(c.id) ?? c));
  const outCo = [...st.courses, ...addedCo].map((c) => changedCo.get(c.id) ?? c);
  const kv = st.kv.filter((k) => !legacyKv.includes(k));
  if (needV2) kv.push({ id: ENT_V2_FLAG, value: '1' });
  if (needCatalog) kv.push({ id: ENT_CATALOG_KEY, value: String(CATALOG_VERSION) });
  return { channels: outCh, courses: outCo, kv };
}

/** Apply the seed to the store (synchronous, one `setState`). Returns true when it changed something. */
export function applySeed(opts: { cloud: boolean }, snap: CourseSnapshot | null): boolean {
  if (!entertainmentMigrationReady(opts.cloud)) return false;
  const p = planSeed(useStore.getState(), snap);
  if (!p) return false;
  useStore.setState(p as never);
  return true;
}

/** Seed the catalog into the store, then fold in the legacy migrations. Idempotent (kv 'ent-v2' / 'ent-catalog'), never overwrites an existing row,
    only after the first cloud sync (or at once in local mode). `snapshot` overrides the fetch of /courses.json (tests). */
export async function seedCatalog(opts: { cloud: boolean; snapshot?: CourseSnapshot | null }): Promise<boolean> {
  if (!entertainmentMigrationReady(opts.cloud)) return false;
  const snap = opts.snapshot !== undefined ? opts.snapshot : await loadCourseSnapshot();
  return applySeed(opts, snap); // re-checks the gate and the flags synchronously: the store may have changed while the snapshot loaded
}

/** Start path (src/main.tsx): run now when possible, otherwise as soon as the first cloud sync is done (store subscription). */
export function scheduleEntertainmentMigration(cloud: boolean): void {
  let running = false;
  const done = () => { const s = useStore.getState(); return s.kv.some((k) => k.id === ENT_V2_FLAG) && Number(s.kv.find((k) => k.id === ENT_CATALOG_KEY)?.value) >= CATALOG_VERSION && !s.kv.some((k) => /^(crs|chs|crsx):/.test(k.id)); };
  const attempt = (): boolean => {
    if (!entertainmentMigrationReady(cloud)) return false;
    if (done()) return true;
    if (!running) { running = true; seedCatalog({ cloud }).catch(() => { /* retried on the next store change */ }).finally(() => { running = false; }); }
    return false;
  };
  try {
    if (attempt()) return;
    const off = useStore.subscribe(() => { if (attempt()) off(); });
  } catch { /* storage unavailable */ }
}
