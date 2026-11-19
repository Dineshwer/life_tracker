import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });

const BASES = ['https://a.test', 'https://b.test'];
let handler: (url: string) => unknown;
let calls: string[] = [];
let inflight = 0, maxInflight = 0;
const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('https://api.invidious.io')) return { ok: true, json: async () => BASES.map((b) => [b, { api: true, cors: true, type: 'https', uri: b }]) };
  calls.push(url); inflight++; maxInflight = Math.max(maxInflight, inflight);
  await new Promise((r) => setTimeout(r, 2));
  inflight--;
  const out = handler(url);
  if (out instanceof Error) throw out;
  return { ok: true, status: 200, json: async () => out };
});
vi.stubGlobal('fetch', fetchMock);

import { thumb, embedPlaylistUrl, playlistUrl, playlistVideos, channelPlaylists, parseVideos, YtError } from '../../../src/lib/yt';

const id = (n: number) => `vid${String(n).padStart(8, '0')}`;
const vid = (n: number, extra = {}) => ({ videoId: id(n), title: `T${n}`, lengthSeconds: 60 + n, index: n, author: 'A', ...extra });
const ids = (r: { videos: { ytId: string }[] }) => r.videos.map((v) => v.ytId);

beforeEach(() => { store.clear(); calls = []; inflight = 0; maxInflight = 0; fetchMock.mockClear(); });

describe('url helpers', () => {
  it('thumb sizes', () => {
    expect(thumb('abc')).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
    expect(thumb('abc', 'hq')).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
    expect(thumb('abc', 'max')).toBe('https://i.ytimg.com/vi/abc/maxresdefault.jpg');
  });
  it('embed and playlist urls', () => {
    expect(embedPlaylistUrl('PL1')).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=PL1');
    expect(embedPlaylistUrl('PL1', 3)).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=PL1&index=3');
    expect(playlistUrl('PL1')).toBe('https://www.youtube.com/playlist?list=PL1');
  });
});

describe('parseVideos', () => {
  it('filters live/upcoming/premium/private/malformed and tolerates missing fields', () => {
    const r = parseVideos([vid(1), vid(2, { liveNow: true }), vid(3, { isUpcoming: true }), vid(4, { premium: true }), vid(5, { title: '[Private video]' }),
      { videoId: 'short' }, null, 'x', { videoId: id(6), title: 'No dur' }, vid(7)]);
    expect(r.map((v) => v.ytId)).toEqual([id(1), id(6), id(7)]);
    expect(r[1]).toMatchObject({ dur: 0, index: 8 });
  });
  it('non-array input gives []', () => { expect(parseVideos(undefined)).toEqual([]); expect(parseVideos({})).toEqual([]); });
});

describe('playlistVideos', () => {
  it('paginates with overlapping pages, keeps order, dedupes', async () => {
    const all = Array.from({ length: 106 }, (_, i) => vid(i));
    handler = (u) => {
      const p = Number(/page=(\d+)/.exec(u)![1]);
      const videos = p === 1 ? all : p === 2 ? all.slice(50) : [];
      return { title: 'ML', author: 'Josh', videoCount: 106, videos };
    };
    const r = await playlistVideos('PLx');
    expect(r.videos).toHaveLength(106);
    expect(r.videos.map((v) => v.index)).toEqual(Array.from({ length: 106 }, (_, i) => i));
    expect(r.title).toBe('ML'); expect(r.author).toBe('Josh'); expect(r.partial).toBeUndefined();
    expect(r.videos[0]).toMatchObject({ ytId: id(0), title: 'T0', dur: 60 });
  });
  it('follows pages when each is a distinct slice', async () => {
    handler = (u) => { const p = Number(/page=(\d+)/.exec(u)![1]); return { title: 't', author: 'a', videoCount: 5, videos: [vid(p * 2 - 2), vid(p * 2 - 1)].filter((v) => v.index < 5) }; };
    expect(ids(await playlistVideos('PLy'))).toEqual([0, 1, 2, 3, 4].map(id));
  });
  it('caches within TTL and refetches after', async () => {
    handler = () => ({ title: 't', author: 'a', videoCount: 2, videos: [vid(0), vid(1)] });
    await playlistVideos('PLc'); const n = calls.length;
    await playlistVideos('PLc'); expect(calls.length).toBe(n);
    const c = JSON.parse(store.get('ledger-yt-pl:PLc')!); c.fetchedAt = Date.now() - 13 * 3600e3; store.set('ledger-yt-pl:PLc', JSON.stringify(c));
    await playlistVideos('PLc'); expect(calls.length).toBeGreaterThan(n);
  });
  it('serves stale cache on failure, throws typed error without cache', async () => {
    store.set('ledger-yt-pl:PLs', JSON.stringify({ id: 'PLs', title: 'old', author: 'a', videos: [{ ytId: id(1), title: 'x', dur: 1, index: 0 }], fetchedAt: 1 }));
    handler = () => new Error('down');
    expect((await playlistVideos('PLs')).title).toBe('old');
    await expect(playlistVideos('PLnone')).rejects.toMatchObject({ name: 'YtError', code: 'unreachable' });
    await expect(playlistVideos('bad id!')).rejects.toBeInstanceOf(YtError);
  });
  it('fails over to another mirror', async () => {
    handler = (u) => u.startsWith(BASES[0]) ? new Error('dead') : { title: 't', author: 'a', videoCount: 1, videos: [vid(0)] };
    const r = await playlistVideos('PLf'); expect(r.videos).toHaveLength(1);
    expect(calls.some((c) => c.startsWith(BASES[1]))).toBe(true);
  });
  it('returns partial data when a later page fails', async () => {
    handler = (u) => /page=1/.test(u) ? { title: 't', author: 'a', videoCount: 150, videos: Array.from({ length: 100 }, (_, i) => vid(i)) } : new Error('x');
    const r = await playlistVideos('PLp'); expect(r.videos).toHaveLength(100); expect(r.partial).toBe(true);
  });
  it('maps an API error to notfound', async () => {
    handler = () => ({ error: 'Playlist does not exist.' });
    await expect(playlistVideos('PLnf')).rejects.toMatchObject({ code: 'notfound' });
  });
  it('never exceeds 3 parallel requests', async () => {
    handler = () => ({ title: 't', author: 'a', videoCount: 1, videos: [vid(0)] });
    await Promise.all(Array.from({ length: 10 }, (_, i) => playlistVideos(`PLpar${i}`)));
    expect(maxInflight).toBeLessThanOrEqual(3); expect(maxInflight).toBeGreaterThan(1);
  });
});

describe('channelPlaylists', () => {
  const UC = 'UCsXVk37bltHxD1rDPwtNM8Q';
  it('parses, drops junk, caches, serves stale on error', async () => {
    handler = () => ({ playlists: [{ playlistId: 'PL1', title: 'One', videoCount: 5 }, { title: 'no id' }, { playlistId: 'PL2', title: 'Two' }, null] });
    expect(await channelPlaylists(UC)).toEqual([{ id: 'PL1', title: 'One', count: 5 }, { id: 'PL2', title: 'Two', count: 0 }]);
    const n = calls.length; await channelPlaylists(UC); expect(calls.length).toBe(n);
    const c = JSON.parse(store.get(`ledger-yt-chpl:${UC}`)!); c.at = 1; store.set(`ledger-yt-chpl:${UC}`, JSON.stringify(c));
    handler = () => new Error('down');
    expect(await channelPlaylists(UC)).toHaveLength(2);
  });
  it('throws typed error with no cache', async () => {
    handler = () => new Error('down');
    await expect(channelPlaylists('UCaaaaaaaaaaaaaaaaaaaaaa')).rejects.toMatchObject({ code: 'unreachable' });
  });
});
