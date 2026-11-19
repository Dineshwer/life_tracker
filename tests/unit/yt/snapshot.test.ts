import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });

const MIRROR = 'https://a.test';
let snapshot: () => { ok: boolean; body?: unknown; throws?: boolean };
let mirror: (url: string) => unknown; // return a json object, or an Error for a network failure
let calls: string[] = [];
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url.startsWith('https://api.invidious.io')) return { ok: true, json: async () => [[MIRROR, { api: true, cors: true, type: 'https', uri: MIRROR }]] };
  if (url === '/courses.json') { calls.push(url); const s = snapshot(); if (s.throws) throw new Error('offline'); return { ok: s.ok, json: async () => s.body }; }
  calls.push(url);
  const out = mirror(url);
  if (out instanceof Error) throw out;
  return { ok: true, status: 200, json: async () => out };
}));

const id = (n: number) => `vid${String(n).padStart(8, '0')}`;
const PL = 'PLsnapshot0001';
const snapBody = (n = 3, at = 1000) => ({ v: 1, at, playlists: { [PL]: { title: 'Snap', author: 'Auth', videos: Array.from({ length: n }, (_, i) => [id(i), `S${i}`, 60 + i]) } } });
const mirrorBody = (n: number, title = 'Live') => ({ title, author: 'A', videoCount: n, videos: Array.from({ length: n }, (_, i) => ({ videoId: id(i), title: `M${i}`, lengthSeconds: 10 + i, index: i })) });
const ids = (r: { videos: { ytId: string }[] }) => r.videos.map((v) => v.ytId);
const tick = () => new Promise((r) => setTimeout(r, 30));

async function load() { vi.resetModules(); return await import('../../../src/lib/yt'); }

beforeEach(() => { store.clear(); calls = []; snapshot = () => ({ ok: true, body: snapBody() }); mirror = () => new Error('mirror down'); });

describe('bundled snapshot', () => {
  it('answers from the snapshot first, with index = position, and fetches courses.json once', async () => {
    const yt = await load();
    const a = await yt.playlistVideos(PL);
    expect(a.title).toBe('Snap'); expect(ids(a)).toEqual([id(0), id(1), id(2)]); expect(a.videos.map((v) => v.index)).toEqual([0, 1, 2]);
    expect(a.videos[1]).toMatchObject({ title: 'S1', dur: 61 });
    await tick(); await yt.playlistVideos(PL);
    expect(calls.filter((c) => c === '/courses.json')).toHaveLength(1);
    expect(yt.snapshotInfo()).toEqual({ at: 1000, count: 1 });
  });

  it('refreshes in the background: caches a differing complete mirror result and notifies subscribers', async () => {
    mirror = () => mirrorBody(5);
    const yt = await load(); const cb = vi.fn();
    yt.onPlaylistUpdate(PL, cb);
    const a = await yt.playlistVideos(PL);
    expect(a.videos).toHaveLength(3);                       // returned immediately from the snapshot
    await tick();
    expect(cb).toHaveBeenCalledTimes(1); expect(cb.mock.calls[0][0].videos).toHaveLength(5);
    const b = await yt.playlistVideos(PL);                  // now the fresh cache wins
    expect(b.videos).toHaveLength(5); expect(b.title).toBe('Live');
  });

  it('unsubscribe stops notifications', async () => {
    mirror = () => mirrorBody(5);
    const yt = await load(); const cb = vi.fn();
    yt.onPlaylistUpdate(PL, cb)();
    await yt.playlistVideos(PL); await tick();
    expect(cb).not.toHaveBeenCalled();
  });

  it('mirror down still serves the snapshot and does not throw', async () => {
    const yt = await load(); const cb = vi.fn(); yt.onPlaylistUpdate(PL, cb);
    const a = await yt.playlistVideos(PL); await tick();
    expect(a.videos).toHaveLength(3); expect(cb).not.toHaveBeenCalled();
    expect(store.has(`ledger-yt-pl:${PL}`)).toBe(false);
  });

  it('unknown id falls to the mirror; throws YtError only when the mirror is also down', async () => {
    mirror = () => mirrorBody(2);
    let yt = await load();
    expect(ids(await yt.playlistVideos('PLunknown0001'))).toEqual([id(0), id(1)]);
    mirror = () => new Error('down'); yt = await load(); store.clear();
    await expect(yt.playlistVideos('PLunknown0002')).rejects.toMatchObject({ name: 'YtError', code: 'unreachable' });
  });

  it('malformed snapshot is ignored (mirror used)', async () => {
    mirror = () => mirrorBody(2);
    for (const body of ['nope', { v: 2, at: 1, playlists: {} }, { v: 1, at: 'x', playlists: {} }, { v: 1, at: 1, playlists: [] }, null]) {
      store.clear(); snapshot = () => ({ ok: true, body });
      const yt = await load();
      expect(ids(await yt.playlistVideos(PL))).toEqual([id(0), id(1)]);
      expect(yt.snapshotInfo()).toBeNull();
    }
    store.clear(); snapshot = () => ({ ok: false }); let yt = await load();
    expect((await yt.playlistVideos(PL)).videos).toHaveLength(2);
    store.clear(); snapshot = () => ({ ok: true, throws: true }); yt = await load();
    expect((await yt.playlistVideos(PL)).videos).toHaveLength(2);
  });

  it('skips malformed entries inside a valid snapshot', async () => {
    snapshot = () => ({ ok: true, body: { v: 1, at: 5, playlists: { [PL]: { title: 'T', author: '', videos: [[id(1), 'ok', 5], ['bad', 'x', 1], [id(2), '', 1], 'junk', [id(3), 'ok2', 'NaN']] } } } });
    const yt = await load(); const a = await yt.playlistVideos(PL);
    expect(ids(a)).toEqual([id(1), id(3)]); expect(a.videos.map((v) => v.index)).toEqual([0, 1]);
  });
});
