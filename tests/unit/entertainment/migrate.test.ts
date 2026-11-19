import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../../src/store';
import { seed, OLD_DEFAULT_CHANNEL_IDS, DEFAULT_CHANNELS } from '../../../src/seed';
import { seedCatalog, ENT_V2_FLAG, ENT_CATALOG_KEY } from '../../../src/entertainment/migrate';
import { CHANNEL_PICKS, CATALOG_VERSION, CHANNELS_ALL, COURSES_ALL, handleId } from '../../../src/entertainment/catalog';
import { courseActions, channelActions } from '../../../src/entertainment/state';
import { validateItem, coerceItem, sanitizeState } from '../../../src/lib/validate';
import { buildBackup } from '../../../src/lib/backup';
import { zustandStoreAdapter } from '../../../src/lib/storeAdapter';
import { TOPICS } from '../../../src/entertainment/contract';
import type { Course } from '../../../src/types';

const oldCh = OLD_DEFAULT_CHANNEL_IDS.map((id) => ({ id, handle: '@' + id, topic: 'sec' as const }));
const reset = (channels: unknown[] = [], extra: object = {}) => useStore.setState({ ...seed(), channels, courses: [], kv: [], syncCache: undefined, ...extra } as never);
const local = { cloud: false };
const firstPlaylist = COURSES_ALL.find((c) => c.kind === 'playlist')!;
const snap = { at: 1000, playlists: { [firstPlaylist.id]: { videos: [['abcdefghijk', 'Lecture 1', 600], ['bbbbbbbbbbb', 'Lecture 2', 700], ['bad']] } } };
const sorted = <T extends { id: string }>(l: T[]) => JSON.stringify([...l].sort((a, b) => a.id.localeCompare(b.id)));

describe('seedCatalog', () => {
  beforeEach(() => reset());
  it('inserts every catalog entry (picks -> mine, suggestions -> suggested) with the lectures from the snapshot', async () => {
    expect(await seedCatalog({ ...local, snapshot: snap })).toBe(true);
    const s = useStore.getState();
    expect(s.channels.length).toBe(CHANNELS_ALL.length); expect(s.courses.length).toBe(COURSES_ALL.length);
    for (const c of CHANNELS_ALL) expect(s.channels.find((x) => x.id === handleId(c.handle))).toMatchObject({ list: c.origin === 'pick' ? 'mine' : 'suggested', origin: c.origin, topic: c.topic, name: c.name });
    for (const c of COURSES_ALL) expect(s.courses.find((x) => x.id === c.id)).toMatchObject({ list: c.origin === 'pick' ? 'mine' : 'suggested', origin: c.origin, kind: c.kind, title: c.title });
    expect(s.courses.find((c) => c.id === firstPlaylist.id)).toMatchObject({ videos: [['abcdefghijk', 'Lecture 1', 600], ['bbbbbbbbbbb', 'Lecture 2', 700]], videosAt: 1000 });
    expect(s.kv.find((k) => k.id === ENT_CATALOG_KEY)?.value).toBe(String(CATALOG_VERSION));
    expect(s.kv.find((k) => k.id === ENT_V2_FLAG)?.value).toBe('1');
    expect(s.channels.every((c) => validateItem('channels', c))).toBe(true);
    expect(s.courses.every((c) => validateItem('courses', c))).toBe(true);
  });
  it('tolerates a missing snapshot', async () => {
    expect(await seedCatalog({ ...local, snapshot: null })).toBe(true);
    expect(useStore.getState().courses.find((c) => c.id === firstPlaylist.id)?.videos).toBeUndefined();
  });
  it('is idempotent', async () => {
    await seedCatalog({ ...local, snapshot: snap });
    const a = JSON.stringify(useStore.getState());
    expect(await seedCatalog({ ...local, snapshot: snap })).toBe(false);
    expect(JSON.stringify(useStore.getState())).toBe(a);
  });
  it('never overwrites an existing row (user choices win) and does not re-add after a user change', async () => {
    reset([{ id: handleId(CHANNELS_ALL[0].handle), handle: CHANNELS_ALL[0].handle, topic: 'art', list: 'hidden', name: 'Mine' }], { courses: [{ id: firstPlaylist.id, kind: 'playlist', title: 'My title', topic: 'art', list: 'hidden', origin: 'pick' }] });
    await seedCatalog({ ...local, snapshot: snap });
    const s = useStore.getState();
    expect(s.channels.find((c) => c.id === handleId(CHANNELS_ALL[0].handle))).toMatchObject({ topic: 'art', list: 'hidden', name: 'Mine' });
    expect(s.courses.find((c) => c.id === firstPlaylist.id)).toMatchObject({ title: 'My title', list: 'hidden' });
    expect(s.courses.find((c) => c.id === firstPlaylist.id)?.videos).toBeUndefined();
    courseActions().addToMine(firstPlaylist.id);
    await seedCatalog({ ...local, snapshot: snap });
    expect(useStore.getState().courses.find((c) => c.id === firstPlaylist.id)?.list).toBe('mine');
  });
  it('a version bump inserts only entries without a row', async () => {
    await seedCatalog({ ...local, snapshot: snap });
    const dropped = useStore.getState().courses[0]; const before = useStore.getState().courses.length;
    useStore.setState((s) => ({ courses: s.courses.filter((c) => c.id !== dropped.id).map((c) => ({ ...c, title: 'edited ' + c.id })), kv: s.kv.map((k) => (k.id === ENT_CATALOG_KEY ? { ...k, value: '0' } : k)) }));
    await seedCatalog({ ...local, snapshot: snap });
    const s = useStore.getState();
    expect(s.courses.length).toBe(before);
    expect(s.courses.filter((c) => c.title.startsWith('edited ')).length).toBe(before - 1);
  });
  it('two devices converge on identical rows', async () => {
    const start = [...oldCh, { id: 'mine1', handle: '@Mine1', topic: 'per' as const }];
    reset(start); await seedCatalog({ ...local, snapshot: snap });
    const a = { ch: sorted(useStore.getState().channels), co: sorted(useStore.getState().courses), kv: sorted(useStore.getState().kv) };
    reset(start); await seedCatalog({ ...local, snapshot: snap });
    expect({ ch: sorted(useStore.getState().channels), co: sorted(useStore.getState().courses), kv: sorted(useStore.getState().kv) }).toEqual(a);
  });
  it('swaps untouched old default channels, keeps user channels and maps legacy topics', async () => {
    reset([...oldCh, { id: 'mine1', handle: '@Mine1', topic: 'sec' }, { id: 'mine2', handle: '@Mine2', topic: 'per' }, { id: 'mine3', handle: '@Mine3', topic: 'code' }, { id: 'mine4', handle: '@Mine4', topic: 'sci' }]);
    await seedCatalog({ ...local, snapshot: null });
    const ch = useStore.getState().channels;
    for (const o of OLD_DEFAULT_CHANNEL_IDS) if (!CHANNELS_ALL.some((p) => handleId(p.handle) === o)) expect(ch.some((c) => c.id === o)).toBe(false);
    expect(ch.filter((c) => c.id.startsWith('mine')).map((c) => c.topic)).toEqual(['tech', 'comm', 'tech', 'sci']);
    for (const p of CHANNEL_PICKS) expect(ch.find((c) => c.id === handleId(p.handle))).toMatchObject({ topic: p.topic, list: 'mine' });
    expect(new Set(ch.map((c) => c.id)).size).toBe(ch.length);
  });
  it('folds the first-model kv rows (crs:/chs:/crsx:) into rows and deletes them', async () => {
    const sugg = COURSES_ALL.find((c) => c.origin === 'suggest')!; const pick = COURSES_ALL.find((c) => c.origin === 'pick')!; const ch = CHANNELS_ALL.find((c) => c.origin === 'suggest')!;
    reset([], { kv: [{ id: `crs:${sugg.id}`, value: 'mine' }, { id: `crs:${pick.id}`, value: 'out' }, { id: `chs:${handleId(ch.handle)}`, value: 'hide' }, { id: 'crsx:PLcustomaaaaaa', value: JSON.stringify({ title: 'Mine', topic: 'econ' }) }, { id: 'ledger-gym-start', value: 'x' }] });
    await seedCatalog({ ...local, snapshot: null });
    const s = useStore.getState();
    expect(s.courses.find((c) => c.id === sugg.id)?.list).toBe('mine');
    expect(s.courses.find((c) => c.id === pick.id)?.list).toBe('suggested');
    expect(s.channels.find((c) => c.id === handleId(ch.handle))?.list).toBe('hidden');
    expect(s.courses.find((c) => c.id === 'PLcustomaaaaaa')).toMatchObject({ origin: 'custom', list: 'mine', topic: 'econ', title: 'Mine' });
    expect(s.kv.filter((k) => /^(crs|chs|crsx):/.test(k.id))).toEqual([]);
    expect(s.kv.some((k) => k.id === 'ledger-gym-start')).toBe(true);
  });
  it('with a cloud account it waits for the first sync (syncCache.ready)', async () => {
    reset([...oldCh]);
    expect(await seedCatalog({ cloud: true, snapshot: null })).toBe(false);
    expect(useStore.getState().courses.length).toBe(0);
    useStore.setState({ syncCache: { id: 'c', owner: 'u', gen: 1, ready: false } });
    expect(await seedCatalog({ cloud: true, snapshot: null })).toBe(false);
    useStore.setState({ syncCache: { id: 'c', owner: 'u', gen: 1, ready: true } });
    expect(await seedCatalog({ cloud: true, snapshot: null })).toBe(true);
  });
  it('seed DEFAULT_CHANNELS mirror the picks', () => {
    expect(DEFAULT_CHANNELS.map((c) => c.id)).toEqual(CHANNEL_PICKS.map((p) => handleId(p.handle)));
  });
});

describe('hook actions (courses)', () => {
  beforeEach(async () => { reset(); await seedCatalog({ ...local, snapshot: null }); });
  const get = (id: string) => useStore.getState().courses.find((c) => c.id === id);
  it('addToMine / removeFromMine / dismiss / restore on catalog rows', () => {
    const a = courseActions(); const sugg = COURSES_ALL.find((c) => c.origin === 'suggest')!; const pick = COURSES_ALL.find((c) => c.origin === 'pick')!;
    a.addToMine(sugg.id); expect(get(sugg.id)?.list).toBe('mine');
    a.removeFromMine(sugg.id); expect(get(sugg.id)?.list).toBe('suggested');
    a.removeFromMine(pick.id); expect(get(pick.id)?.list).toBe('suggested'); // row stays: re-addable
    a.dismiss(sugg.id); a.dismiss(pick.id); expect(get(sugg.id)?.list).toBe('hidden');
    a.restoreDismissed(); expect(get(sugg.id)?.list).toBe('suggested'); expect(get(pick.id)?.list).toBe('suggested');
  });
  it('addCustom creates a custom row, removeFromMine deletes it, bad link returns null', () => {
    const a = courseActions();
    expect(a.addCustom('nonsense', 't', 'tech')).toBeNull();
    const id = a.addCustom('https://www.youtube.com/playlist?list=PLzzzzzzzzzzzz', ' My course ', 'fin', 'saving');
    expect(id).toBe('PLzzzzzzzzzzzz');
    expect(get(id!)).toMatchObject({ title: 'My course', topic: 'fin', sub: 'saving', list: 'mine', origin: 'custom', kind: 'playlist' });
    a.removeFromMine(id!); expect(get(id!)).toBeUndefined();
  });
  it('addCustom of a catalog playlist just adds it to Mine', () => {
    const a = courseActions(); const sugg = COURSES_ALL.find((c) => c.origin === 'suggest' && c.kind === 'playlist')!;
    expect(a.addCustom(sugg.id, 't', 'tech')).toBe(sugg.id); expect(get(sugg.id)).toMatchObject({ list: 'mine', origin: 'suggest' });
  });
});

describe('hook actions (channels)', () => {
  beforeEach(async () => { reset(); await seedCatalog({ ...local, snapshot: null }); });
  const get = (id: string) => useStore.getState().channels.find((c) => c.id === id);
  it('flips list on catalog rows; custom rows are created and deleted', () => {
    const a = channelActions(); const sugg = CHANNELS_ALL.find((c) => c.origin === 'suggest')!; const id = handleId(sugg.handle);
    a.addToMine(sugg.handle); expect(get(id)?.list).toBe('mine');
    a.removeFromMine(id); expect(get(id)?.list).toBe('suggested');
    a.dismiss(sugg.handle); expect(get(id)?.list).toBe('hidden');
    a.restoreDismissed(); expect(get(id)?.list).toBe('suggested');
    a.addCustom('@MyChan', 'fin', 'stocks'); expect(get('mychan')).toMatchObject({ handle: '@MyChan', topic: 'fin', sub: 'stocks', list: 'mine', origin: 'custom' });
    a.removeFromMine('mychan'); expect(get('mychan')).toBeUndefined();
  });
});

describe('collection wiring', () => {
  const course: Course = { id: 'PLaaaaaaaaaaaa', kind: 'playlist', title: 'T', topic: 'tech', list: 'mine', origin: 'pick', videos: [['abcdefghijk', 'L', 5]], videosAt: 5 };
  it('schema: accepts good, rejects bad enums and over-cap videos; coerceItem cuts instead of dropping', () => {
    expect(validateItem('courses', course)).toBe(true);
    expect(validateItem('courses', { ...course, list: 'x' })).toBe(false);
    expect(validateItem('courses', { ...course, topic: 'sec' })).toBe(false);
    expect(validateItem('courses', { ...course, videos: [['a', 'b']] })).toBe(false);
    const big = { ...course, videos: Array.from({ length: 600 }, (_, i) => [`v${i}`, 'x'.repeat(400), 1]) };
    expect(validateItem('courses', big)).toBe(false);
    const c = coerceItem('courses', big) as Course;
    expect(c.videos).toHaveLength(500); expect(c.videos![0][1]).toHaveLength(300); expect(validateItem('courses', c)).toBe(true);
    expect(coerceItem('courses', { ...course, title: 'x'.repeat(400) }).title).toHaveLength(300);
  });
  it('channel schema: new optional fields; old rows still valid; new and legacy topics', () => {
    for (const t of TOPICS) expect(validateItem('channels', { id: 'a', handle: '@a', topic: t.id })).toBe(true);
    for (const t of ['sec', 'per', 'code']) expect(validateItem('channels', { id: 'a', handle: '@a', topic: t })).toBe(true);
    expect(validateItem('channels', { id: 'a', handle: '@a', topic: 'fin', sub: 'stocks', name: 'A', about: 'x', list: 'suggested', origin: 'suggest' })).toBe(true);
    expect(validateItem('channels', { id: 'a', handle: '@a', topic: 'fin', list: 'nope' })).toBe(false);
    expect(validateItem('channels', { id: 'a', handle: '@a', topic: 'fin', sub: 'bogus' })).toBe(false);
  });
  it('store round trip, adapter read/write, backup export/import, sanitize', () => {
    reset(); useStore.getState().upsertCourse(course);
    expect(useStore.getState().courses).toEqual([course]);
    expect(zustandStoreAdapter().read().courses).toEqual([course]);
    const b = buildBackup(); expect(b.collections.courses).toEqual([course]);
    useStore.getState().removeCourse(course.id); expect(useStore.getState().courses).toEqual([]);
    useStore.getState().importAll(JSON.stringify(b)); expect(useStore.getState().courses).toEqual([course]);
    zustandStoreAdapter().write({ courses: [course, { id: 'bad' }] });
    expect(useStore.getState().courses).toEqual([course]);
    const { state, report } = sanitizeState({ courses: [course, { ...course, id: 'x', list: 'bogus' }, { ...course }] });
    expect(state.courses).toEqual([course]); expect(report.dropped.courses.count).toBe(1); expect(report.deduped).toBe(1);
  });
  it('store action coerces on upsert', () => {
    reset(); useStore.getState().upsertCourse({ ...course, title: 'x'.repeat(400) });
    expect(useStore.getState().courses[0].title).toHaveLength(300);
  });
});
