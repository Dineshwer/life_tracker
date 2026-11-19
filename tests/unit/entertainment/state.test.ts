import { describe, it, expect } from 'vitest';
import { computeCourses, computeChannels, parsePlaylistId, watchedIds, courseProgress, mapTopic } from '../../../src/entertainment/state';
import type { CatalogChannel } from '../../../src/entertainment/contract';
import type { Course, Video } from '../../../src/types';

const C = (id: string, list: Course['list'], origin: Course['origin'], extra: Partial<Course> = {}): Course => ({ id, kind: 'playlist', title: id, topic: 'tech', list, origin, ...extra });
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe('computeCourses', () => {
  it('splits by list, counts hidden, keeps catalog order', () => {
    const rows = [C('c', 'suggested', 'suggest'), C('a', 'mine', 'pick'), C('b', 'hidden', 'suggest'), C('z', 'mine', 'custom', { title: 'Mine' })];
    const r = computeCourses(rows, ['a', 'c']);
    expect(ids(r.mine)).toEqual(['a', 'z']);
    expect(ids(r.suggested)).toEqual(['c']);
    expect(r.dismissedCount).toBe(1);
    expect(r.mine[1]).toMatchObject({ custom: true, origin: 'pick', list: 'mine', title: 'Mine' });
    expect(r.mine[0].custom).toBeUndefined();
  });
  it('carries videos to the view', () => {
    expect(computeCourses([C('a', 'mine', 'pick', { videos: [['x', 'T', 5]], videosAt: 9 })]).mine[0]).toMatchObject({ videos: [['x', 'T', 5]], videosAt: 9 });
  });
});

describe('computeChannels', () => {
  const cat: CatalogChannel[] = [
    { handle: '@Pick', name: 'Pick', topic: 'tech', origin: 'pick', cid: 'UC1', about: 'abt' },
    { handle: '@Sugg', name: 'Sugg', topic: 'fin', sub: 'saving', origin: 'suggest' },
  ];
  it('rows without list are mine; legacy topics mapped; unknown handles are custom; metadata falls back to the catalog', () => {
    const r = computeChannels([{ id: 'pick', handle: '@Pick', topic: 'sec' }, { id: 'mine', handle: '@Mine', topic: 'per' }], cat);
    expect(r.mine.map((c) => [c.id, c.topic, !!c.custom])).toEqual([['pick', 'tech', false], ['mine', 'comm', true]]);
    expect(r.mine[0]).toMatchObject({ cid: 'UC1', name: 'Pick', about: 'abt' });
    expect(r.mine[1].name).toBe('Mine');
  });
  it('suggested / hidden rows', () => {
    const r = computeChannels([{ id: 'sugg', handle: '@Sugg', topic: 'fin', sub: 'saving', list: 'suggested', origin: 'suggest', name: 'Sugg' }, { id: 'h', handle: '@h', topic: 'art', list: 'hidden', origin: 'suggest' }], cat);
    expect(r.mine).toEqual([]);
    expect(r.suggested[0]).toMatchObject({ id: 'sugg', list: 'suggested', sub: 'saving', origin: 'suggest' });
    expect(r.dismissedCount).toBe(1);
  });
  it('mapTopic', () => {
    expect([mapTopic('sec'), mapTopic('code'), mapTopic('per'), mapTopic('sci'), mapTopic('psy'), mapTopic('fin')]).toEqual(['tech', 'tech', 'comm', 'sci', 'psy', 'fin']);
  });
});

describe('parsePlaylistId', () => {
  const id = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
  it.each([
    [`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${id}`, id],
    [`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${id}&index=3`, id],
    [`https://www.youtube.com/playlist?list=${id}`, id],
    [`youtube.com/playlist?list=${id}`, id],
    [`https://youtu.be/dQw4w9WgXcQ?list=${id}`, id],
    [id, id], [`  ${id} `, id],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', null],
    ['dQw4w9WgXcQ', null], ['', null], ['hello world', null],
    ['https://example.com/playlist?list=' + id, null],
  ])('%s', (input, out) => expect(parsePlaylistId(input)).toBe(out));
});

describe('progress', () => {
  const v = (ytId: string, w?: string): Video => ({ id: ytId, ytId, title: ytId, tag: 'learn', addedAt: '2026-01-01T00:00:00.000Z', ...(w ? { watchedAt: w } : {}) });
  const vids = [v('a', '2026-01-02T00:00:00.000Z'), v('b'), v('c', '2026-01-02T00:00:00.000Z'), v('zz', '2026-01-02T00:00:00.000Z')];
  it('watchedIds ignores unwatched', () => expect([...watchedIds(vids)].sort()).toEqual(['a', 'c', 'zz']));
  it('courseProgress', () => {
    expect(courseProgress(['a', 'b', 'c', 'd'], vids)).toEqual({ done: 2, total: 4, nextIndex: 1 });
    expect(courseProgress(['a', 'c'], vids)).toEqual({ done: 2, total: 2, nextIndex: -1 });
    expect(courseProgress([], vids)).toEqual({ done: 0, total: 0, nextIndex: -1 });
    expect(courseProgress(['x', 'y'], [])).toEqual({ done: 0, total: 2, nextIndex: 0 });
  });
});
