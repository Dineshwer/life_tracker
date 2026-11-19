import { useMemo } from 'react';
import { useStore } from '../store';
import type { Channel, Course, Video } from '../types';
import type { CatalogChannel, CatalogCourse, ChannelView, ChannelsApi, CourseView, CoursesApi, FinSub, TopicId } from './contract';
import { TOPICS } from './contract';
import { CHANNELS_ALL, COURSES_ALL, handleId } from './catalog';

/* Data layer for the Entertainment page. The synced store is the master: the `courses` and `channels` collections hold every entry the page
   shows (Mine, Suggested and dismissed ones) in their `list` field ('mine' | 'suggested' | 'hidden'); `videos` holds watch progress.
   The static catalog only SEEDS rows once (see migrate.ts); after that nothing here reads it, except as display fallback and ordering. */

const TOPIC_IDS = new Set<string>(TOPICS.map((t) => t.id));
export const LEGACY_TOPIC: Record<string, TopicId> = { sec: 'tech', code: 'tech', per: 'comm', sci: 'sci' };
/** Map any stored topic (including the old 'sec' | 'per' | 'code') to a TopicId. */
export const mapTopic = (t: string): TopicId => (TOPIC_IDS.has(t) ? (t as TopicId) : LEGACY_TOPIC[t] ?? 'tech');

/* ---- playlist ids and progress ---- */
/** Accepts a youtube watch/playlist URL carrying `list=`, or a bare playlist id (PL..., UU..., FL..., OLAK5uy_..., RD...). Returns null otherwise. */
export function parsePlaylistId(input: string): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  if (/^(PL|UU|FL|RD|OLAK5uy_)[\w-]{10,}$/.test(s)) return s;
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(u.hostname)) return null;
  const list = u.searchParams.get('list');
  return list && /^[\w-]{10,64}$/.test(list) ? list : null;
}
/** ytIds of videos that were watched. */
export const watchedIds = (videos: Video[]): Set<string> => new Set(videos.filter((v) => v.watchedAt).map((v) => v.ytId));
/** done/total over the playlist's lectures; nextIndex = first lecture not watched yet, or -1 when all are done (or the playlist is empty). */
export function courseProgress(playlistVideoIds: string[], videos: Video[]): { done: number; total: number; nextIndex: number } {
  const w = watchedIds(videos);
  let done = 0; let nextIndex = -1;
  playlistVideoIds.forEach((id, i) => { if (w.has(id)) done++; else if (nextIndex < 0) nextIndex = i; });
  return { done, total: playlistVideoIds.length, nextIndex };
}

/* ---- courses ---- */
const orderBy = <T extends { id: string }>(list: T[], order?: string[]): T[] => {
  if (!order?.length) return list;
  const pos = new Map(order.map((id, i) => [id, i]));
  return list.map((x, i) => [x, i] as const).sort((a, b) => (pos.get(a[0].id) ?? 1e9) - (pos.get(b[0].id) ?? 1e9) || a[1] - b[1]).map((x) => x[0]);
};
const courseView = (c: Course, list: 'mine' | 'suggested'): CourseView => {
  const { origin, list: _l, ...rest } = c; void _l;
  return { ...rest, origin: origin === 'custom' ? 'pick' : origin, list, ...(origin === 'custom' ? { custom: true } : {}) };
};
/** Split the courses collection into the two lists (+ how many are dismissed). `order` (catalog ids) keeps the catalog order; other rows follow in store order. */
export function computeCourses(courses: Course[], order?: string[]): { mine: CourseView[]; suggested: CourseView[]; dismissedCount: number } {
  const mine: CourseView[] = []; const suggested: CourseView[] = []; let dismissedCount = 0;
  for (const c of orderBy(courses, order)) {
    if (c.list === 'mine') mine.push(courseView(c, 'mine'));
    else if (c.list === 'suggested') suggested.push(courseView(c, 'suggested'));
    else if (c.list === 'hidden') dismissedCount++;
  }
  return { mine, suggested, dismissedCount };
}
const courseRow = (c: CatalogCourse, list: Course['list']): Course => ({
  id: c.id, kind: c.kind, title: c.title, ...(c.by ? { by: c.by } : {}), topic: c.topic, ...(c.sub ? { sub: c.sub } : {}), list, origin: c.origin,
  ...(c.url ? { url: c.url } : {}), ...(c.count ? { count: c.count } : {}), ...(c.about ? { about: c.about } : {}),
});
/** Course actions as pure functions over the store, shared by the hook and the tests. */
export const courseActions = (catalog: CatalogCourse[] = COURSES_ALL) => {
  const st = () => useStore.getState();
  const row = (id: string) => st().courses.find((c) => c.id === id);
  const setList = (id: string, list: Course['list']) => {
    const r = row(id);
    if (r) { if (r.list !== list) st().upsertCourse({ ...r, list }); return true; }
    const cat = catalog.find((c) => c.id === id);
    if (cat) { st().upsertCourse(courseRow(cat, list)); return true; } // not seeded yet: create from the catalog
    return false;
  };
  return {
    addToMine: (id: string) => { setList(id, 'mine'); },
    removeFromMine(id: string) { const r = row(id); if (r?.origin === 'custom') st().removeCourse(id); else setList(id, 'suggested'); },
    dismiss: (id: string) => { setList(id, 'hidden'); },
    restoreDismissed() { for (const c of st().courses) if (c.list === 'hidden') st().upsertCourse({ ...c, list: 'suggested' }); },
    addCustom(urlOrId: string, title: string, topic: TopicId, sub?: FinSub): string | null {
      const id = parsePlaylistId(urlOrId); if (!id) return null;
      const r = row(id);
      if (r) { if (r.list !== 'mine') st().upsertCourse({ ...r, list: 'mine' }); return id; }
      const cat = catalog.find((c) => c.id === id);
      if (cat) { st().upsertCourse(courseRow(cat, 'mine')); return id; }
      st().upsertCourse({ id, kind: 'playlist', title: title.trim() || 'Untitled course', topic, ...(sub ? { sub } : {}), list: 'mine', origin: 'custom' });
      return id;
    },
  };
};

export function useCourses(): CoursesApi {
  const courses = useStore((s) => s.courses);
  const c = useMemo(() => computeCourses(courses, COURSES_ALL.map((x) => x.id)), [courses]);
  return useMemo<CoursesApi>(() => ({ ...c, ...courseActions() }), [c]);
}

/* ---- channels ---- */
type ChRow = Channel;
/** A row without `list` is Mine (rows from before the redesign). A row without `origin` that the catalog does not know is custom. */
const chList = (c: ChRow): 'mine' | 'suggested' | 'hidden' => c.list ?? 'mine';
export function computeChannels(channels: ChRow[], catalog: CatalogChannel[] = [], order?: string[]): { mine: ChannelView[]; suggested: ChannelView[]; dismissedCount: number } {
  const byId = new Map(catalog.map((c) => [handleId(c.handle), c]));
  const mine: ChannelView[] = []; const suggested: ChannelView[] = []; let dismissedCount = 0;
  for (const ch of orderBy(channels, order)) {
    const list = chList(ch);
    if (list === 'hidden') { dismissedCount++; continue; }
    const c = byId.get(ch.id);
    const custom = ch.origin === 'custom' || (!ch.origin && !c);
    const topic = mapTopic(ch.topic);
    const cid = ch.cid ?? c?.cid; const about = ch.about ?? c?.about; const sub = ch.sub ?? (topic === c?.topic ? c?.sub : undefined);
    const view: ChannelView = {
      handle: ch.handle, name: ch.name ?? c?.name ?? ch.handle.replace(/^@/, ''), topic, origin: custom ? 'pick' : (ch.origin ?? c?.origin ?? 'pick') === 'custom' ? 'pick' : ((ch.origin ?? c?.origin ?? 'pick') as 'pick' | 'suggest'),
      ...(cid ? { cid } : {}), ...(sub ? { sub } : {}), ...(about ? { about } : {}), id: ch.id, list, ...(custom ? { custom: true } : {}),
    };
    (list === 'mine' ? mine : suggested).push(view);
  }
  return { mine, suggested, dismissedCount };
}
const chRow = (c: CatalogChannel, list: 'mine' | 'suggested' | 'hidden'): Channel => ({
  id: handleId(c.handle), handle: c.handle, ...(c.cid ? { cid: c.cid } : {}), topic: c.topic, ...(c.sub ? { sub: c.sub } : {}), name: c.name, ...(c.about ? { about: c.about } : {}), list, origin: c.origin,
});
export const channelActions = (catalog: CatalogChannel[] = CHANNELS_ALL) => {
  const st = () => useStore.getState();
  const row = (id: string) => st().channels.find((c) => c.id === id);
  const setList = (key: string, list: 'mine' | 'suggested' | 'hidden') => {
    const id = handleId(key); const r = row(id);
    if (r) { if (r.list !== list && !(list === 'mine' && !r.list)) st().upsert('channels', { ...r, list }); return; }
    const cat = catalog.find((c) => handleId(c.handle) === id);
    if (cat) st().upsert('channels', chRow(cat, list));
    else if (list === 'mine') st().upsert('channels', { id, handle: `@${id}`, topic: 'tech', name: id, list, origin: 'custom' });
  };
  return {
    addToMine: (handle: string) => setList(handle, 'mine'),
    removeFromMine(id: string) {
      const r = row(id);
      if (!r) return;
      const custom = r.origin === 'custom' || (!r.origin && !catalog.some((c) => handleId(c.handle) === id));
      if (custom) st().remove('channels', id); else setList(id, 'suggested');
    },
    dismiss: (handle: string) => setList(handle, 'hidden'),
    restoreDismissed() { for (const c of st().channels) if (c.list === 'hidden') st().upsert('channels', { ...c, list: 'suggested' }); },
    addCustom(handle: string, topic: TopicId, sub?: FinSub) {
      const id = handleId(handle); if (!id) return;
      const r = row(id);
      if (r) { if (chList(r) !== 'mine') st().upsert('channels', { ...r, list: 'mine' }); return; }
      const clean = handle.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/\/.*$/, '');
      st().upsert('channels', { id, handle: clean.startsWith('@') ? clean : `@${clean}`, topic, ...(sub ? { sub } : {}), name: id, list: 'mine', origin: 'custom' });
    },
  };
};

export function useChannels(): ChannelsApi {
  const channels = useStore((s) => s.channels);
  const c = useMemo(() => computeChannels(channels, CHANNELS_ALL, CHANNELS_ALL.map((x) => handleId(x.handle))), [channels]);
  return useMemo<ChannelsApi>(() => ({ ...c, ...channelActions() }), [c]);
}
