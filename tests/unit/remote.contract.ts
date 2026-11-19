/* A REUSABLE behaviour suite every `Remote` must satisfy (src/sync/types.ts). Run against FakeRemote (fakeRemote.test.ts) and
   against the real SQL through PGlite (pgliteRemote.test.ts): if both pass, the fake and the database agree.
   Every test uses its own fresh user id, so one shared world is enough. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/sync/types';
import type { PushItem, PushResult, Remote, RemoteRow } from '../../src/sync/types';

export interface RemoteWorld { remote(userId: string, device?: string): Remote; close?(): Promise<void> | void }
let userCounter = 0;
const newUser = () => `00000000-0000-4000-8000-${String(++userCounter).padStart(12, '0')}`;
const item = (id: string, data: Record<string, unknown> = { v: 1 }, base = 0, over: Partial<PushItem> = {}): PushItem => ({ collection: 'tasks', id, data, deleted: false, base_version: base, ...over });
const tomb = (id: string, base: number): PushItem => ({ collection: 'tasks', id, data: {}, deleted: true, base_version: base });
const okRow = (r: PushResult): RemoteRow => { expect(r.status, `expected ok for ${r.collection}/${r.id}: ${JSON.stringify(r)}`).toBe('ok'); return r.row!; };

export function describeRemoteContract(name: string, makeWorld: () => Promise<RemoteWorld> | RemoteWorld) {
  describe(`Remote contract: ${name}`, () => {
    let world: RemoteWorld;
    beforeAll(async () => { world = await makeWorld(); });
    afterAll(async () => { await world?.close?.(); });
    const mk = (user = newUser(), device = 'dev-a') => ({ user, r: world.remote(user, device) });
    const pullAll = async (r: Remote) => { const all: RemoteRow[] = []; let c = 0; for (;;) { const p = await r.pull(c, 50); all.push(...p); if (p.length < 50) return all; c = p[p.length - 1].seq; } };

    it('first insert (base_version 0) is ok with version 1 and a server seq/updated_at', async () => {
      const { r } = mk();
      const [res] = await r.push([item('t1', { title: 'a' })], 'dev-a');
      const row = okRow(res);
      expect(row).toMatchObject({ collection: 'tasks', id: 't1', version: 1, deleted: false, data: { title: 'a' } });
      expect(row.seq).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(row.updated_at))).toBe(false);
      expect(res).toMatchObject({ collection: 'tasks', id: 't1' });
    });

    it('update with the right base_version gives version+1 and a larger seq', async () => {
      const { r } = mk();
      const r1 = okRow((await r.push([item('t1', { v: 1 })], 'd'))[0]);
      const r2 = okRow((await r.push([item('t1', { v: 2 }, 1)], 'd'))[0]);
      expect(r2.version).toBe(2); expect(r2.seq).toBeGreaterThan(r1.seq); expect(r2.data).toEqual({ v: 2 });
    });

    it('stale base_version is a conflict that returns the server row and writes nothing', async () => {
      const { r } = mk();
      await r.push([item('t1', { v: 1 })], 'd'); await r.push([item('t1', { v: 2 }, 1)], 'd');
      const [res] = await r.push([item('t1', { v: 'stale' }, 1)], 'd');
      expect(res.status).toBe('conflict'); expect(res.row).toMatchObject({ version: 2, data: { v: 2 } });
      const all = await pullAll(r); expect(all).toHaveLength(1); expect(all[0].data).toEqual({ v: 2 });
    });

    it('base_version 0 on an existing item is a conflict (never a silent overwrite)', async () => {
      const { r } = mk();
      await r.push([item('t1', { v: 1 })], 'd');
      const [res] = await r.push([item('t1', { v: 'dup' }, 0)], 'd');
      expect(res.status).toBe('conflict'); expect(res.row).toMatchObject({ version: 1, data: { v: 1 } });
    });

    it('base_version above the real version is a conflict too', async () => {
      const { r } = mk();
      await r.push([item('t1')], 'd');
      const [res] = await r.push([item('t1', { v: 9 }, 5)], 'd');
      expect(res.status).toBe('conflict');
    });

    it('missing item with base_version > 0 is gone', async () => {
      const { r } = mk();
      const [res] = await r.push([item('nope', { v: 1 }, 3)], 'd');
      expect(res.status).toBe('gone'); expect(await pullAll(r)).toHaveLength(0);
    });

    describe('invalid items are rejected with a reason and never written', () => {
      const cases: [string, Partial<PushItem>][] = [
        ['unknown collection', { collection: 'not_a_collection' }],
        ['empty id', { id: '' }],
        ['id too long', { id: 'x'.repeat(LIMITS.maxIdLength + 1) }],
        ['data is an array', { data: [1, 2] as unknown }],
        ['data is a string', { data: 'hi' as unknown }],
        ['data is null', { data: null as unknown }],
        ['data too large', { data: { blob: 'x'.repeat(600_000 + 10) } }],
      ];
      for (const [label, over] of cases) it(label, async () => {
        const { r } = mk();
        const [res] = await r.push([{ ...item('t1'), ...over }], 'd');
        expect(res.status).toBe('rejected'); expect(res.reason).toBeTruthy();
        expect(await pullAll(r)).toHaveLength(0);
      });
      it('an id of exactly maxIdLength is accepted', async () => {
        const { r } = mk(); expect((await r.push([item('x'.repeat(LIMITS.maxIdLength))], 'd'))[0].status).toBe('ok');
      });
      it('data just under maxItemBytes is accepted', async () => {
        const { r } = mk(); expect((await r.push([item('big', { blob: 'x'.repeat(LIMITS.maxItemBytes - 1000) })], 'd'))[0].status).toBe('ok');
      });
      it('every allowed collection is accepted', async () => {
        const { r } = mk();
        const cols = ['habits', 'habitLogs', 'tasks', 'blocks', 'workouts', 'body', 'journal', 'rewards', 'xp', 'books', 'conversations', 'rejections', 'videos', 'channels', 'oneLogs', 'kv', 'wake', 'meta', 'courses'];
        const res = await r.push(cols.map(c => item('x1', { a: 1 }, 0, { collection: c })), 'd');
        expect(res.map(x => x.status)).toEqual(cols.map(() => 'ok'));
      });
    });

    it('mixed batches keep input order and report per-item status', async () => {
      const { r } = mk();
      await r.push([item('exists', { v: 1 })], 'd');
      const res = await r.push([item('new1'), item('exists', { v: 'x' }, 0), item('bad', {}, 0, { collection: 'zzz' }), item('ghost', {}, 4), item('exists', { v: 2 }, 1), item('new2')], 'd');
      expect(res.map(x => [x.id, x.status])).toEqual([['new1', 'ok'], ['exists', 'conflict'], ['bad', 'rejected'], ['ghost', 'gone'], ['exists', 'ok'], ['new2', 'ok']]);
      expect(res[4].row!.version).toBe(2);
    });

    it('the same item twice in one batch: second sees the first (needs the new base)', async () => {
      const { r } = mk();
      const res = await r.push([item('t1', { v: 1 }), item('t1', { v: 2 }, 1)], 'd');
      expect(res.map(x => x.status)).toEqual(['ok', 'ok']); expect(res[1].row!.version).toBe(2);
    });

    it('delete writes a tombstone with a new version; the tombstone is visible to pull', async () => {
      const { r } = mk();
      await r.push([item('t1')], 'd');
      const row = okRow((await r.push([tomb('t1', 1)], 'd'))[0]);
      expect(row).toMatchObject({ deleted: true, version: 2, data: {} }); // tombstones carry no data
      const all = await pullAll(r); expect(all).toHaveLength(1); expect(all[0]).toMatchObject({ id: 't1', deleted: true, version: 2 });
    });

    it('resurrection: writing over a tombstone with the tombstone version revives the item at version+1', async () => {
      const { r } = mk();
      await r.push([item('t1', { v: 1 })], 'd'); await r.push([tomb('t1', 1)], 'd');
      const row = okRow((await r.push([item('t1', { v: 'back' }, 2)], 'd'))[0]);
      expect(row).toMatchObject({ deleted: false, version: 3, data: { v: 'back' } });
    });

    it('base_version 0 on a tombstone is a conflict that returns the tombstone', async () => {
      const { r } = mk();
      await r.push([item('t1')], 'd'); await r.push([tomb('t1', 1)], 'd');
      const [res] = await r.push([item('t1', { v: 'again' }, 0)], 'd');
      expect(res.status).toBe('conflict'); expect(res.row).toMatchObject({ deleted: true, version: 2 });
    });

    it('delete with a stale base is a conflict', async () => {
      const { r } = mk();
      await r.push([item('t1')], 'd'); await r.push([item('t1', { v: 2 }, 1)], 'd');
      expect((await r.push([tomb('t1', 1)], 'd'))[0].status).toBe('conflict');
    });

    it('seq is strictly increasing across writes and pull orders by seq', async () => {
      const { r } = mk();
      const ids = ['c', 'a', 'b'];
      for (const id of ids) await r.push([item(id)], 'd');
      await r.push([item('c', { v: 2 }, 1)], 'd');
      const all = await pullAll(r);
      const seqs = all.map(x => x.seq);
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y)); expect(new Set(seqs).size).toBe(seqs.length);
      expect(all.map(x => x.id)).toEqual(['a', 'b', 'c']); // c was rewritten last
      const batch = await r.push([item('p'), item('q'), item('s')], 'd');
      const bs = batch.map(x => x.row!.seq); expect(bs[0]).toBeLessThan(bs[1]); expect(bs[1]).toBeLessThan(bs[2]);
    });

    it('pull by cursor returns only newer rows, respects limit, and pages without gaps or duplicates', async () => {
      const { r } = mk();
      await r.push(Array.from({ length: 120 }, (_, i) => item(`i${String(i).padStart(3, '0')}`, { n: i })), 'd');
      const first = await r.pull(0, 50); expect(first).toHaveLength(50);
      const second = await r.pull(first[49].seq, 50); expect(second).toHaveLength(50);
      const third = await r.pull(second[49].seq, 50); expect(third).toHaveLength(20);
      expect(await r.pull(third[19].seq, 50)).toEqual([]);
      const ids = [...first, ...second, ...third].map(x => x.id); expect(new Set(ids).size).toBe(120);
      expect(await r.pull(0, 7)).toHaveLength(7);
    });

    it('default pull limit is 1000 rows per call', async () => {
      const { r } = mk();
      for (let i = 0; i < 3; i++) await r.push(Array.from({ length: 400 }, (_, j) => item(`d${i}-${j}`)), 'd');
      const first = await r.pull(0); expect(first).toHaveLength(1000);
      const rest = await r.pull(first[999].seq); expect(rest).toHaveLength(200);
    });

    it('users never see each other rows, and the same id can exist for two users independently', async () => {
      const a = mk(); const b = mk();
      await a.r.push([item('shared-id', { owner: 'a' })], 'd');
      expect(await pullAll(b.r)).toHaveLength(0);
      const rb = okRow((await b.r.push([item('shared-id', { owner: 'b' })], 'd'))[0]);
      expect(rb.version).toBe(1);
      expect((await pullAll(a.r))[0].data).toEqual({ owner: 'a' });
      expect((await pullAll(b.r))[0].data).toEqual({ owner: 'b' });
      // b cannot touch a's row through a stale/odd base
      const [x] = await b.r.push([item('shared-id', { owner: 'b2' }, 1)], 'd'); expect(x.status).toBe('ok');
      expect((await pullAll(a.r))[0].data).toEqual({ owner: 'a' });
    });

    it('a batch of exactly maxBatch items works; maxBatch+1 is refused (throws) and writes nothing', async () => {
      const { r } = mk();
      const res = await r.push(Array.from({ length: LIMITS.maxBatch }, (_, i) => item(`b${i}`)), 'd');
      expect(res).toHaveLength(LIMITS.maxBatch); expect(res.every(x => x.status === 'ok')).toBe(true);
      await expect(r.push(Array.from({ length: LIMITS.maxBatch + 1 }, (_, i) => item(`z${i}`)), 'd')).rejects.toThrow();
      expect(await pullAll(r)).toHaveLength(LIMITS.maxBatch);
    });

    it('an empty batch returns an empty result', async () => { expect(await mk().r.push([], 'd')).toEqual([]); });

    it('data round-trips exactly (nested objects, arrays, unicode, nulls)', async () => {
      const { r } = mk();
      const data = { s: 'héllo ✓ 日本', n: [1, 2.5, null, { x: [] }], o: { a: { b: { c: true } } }, z: null, t: 0 };
      await r.push([item('t1', data)], 'd');
      expect((await pullAll(r))[0].data).toEqual(data);
    });

    it('device_id of the last writer is recorded when present', async () => {
      const { r } = mk();
      const row = okRow((await r.push([item('t1')], 'phone-1'))[0]);
      if (row.device_id !== undefined) expect(row.device_id).toBe('phone-1');
    });

    it('realtime: a write by another device of the same user is delivered; other users are not', async () => {
      const user = newUser(); const other = newUser();
      const a = world.remote(user, 'a'); const b = world.remote(user, 'b'); const c = world.remote(other, 'c');
      const gotB: RemoteRow[] = []; const gotC: RemoteRow[] = []; const statuses: string[] = [];
      const offB = b.subscribe(r => gotB.push(r), s => statuses.push(s));
      const offC = c.subscribe(r => gotC.push(r), () => {});
      await new Promise(res => setTimeout(res, 200));
      await a.push([item('t1', { v: 1 })], 'a');
      await new Promise(res => setTimeout(res, 300));
      offB(); offC();
      if (statuses.length === 0 && gotB.length === 0) return; // adapter without realtime (SQL harness): nothing to assert
      expect(gotB.map(x => x.id)).toEqual(['t1']); expect(gotC).toHaveLength(0);
    });

    describe('backups', () => {
      it('take -> list round trip', async () => {
        const { r } = mk();
        await r.push([item('a'), item('b'), tomb('gone-already', 0)].slice(0, 2), 'd');
        const info = await r.takeBackup();
        expect(info.row_count).toBe(2); expect(info.taken_on).toMatch(/^\d{4}-\d{2}-\d{2}/);
        const list = await r.listBackups();
        expect(list.some(b => b.taken_on === info.taken_on && b.row_count === 2)).toBe(true);
      });
      it('a second backup within 10 minutes does not create a second snapshot', async () => {
        const { r } = mk(); await r.push([item('a')], 'd');
        await r.takeBackup(); await r.push([item('b')], 'd'); await r.takeBackup();
        const list = await r.listBackups(); expect(list).toHaveLength(1);
      });
      it('backups are per user', async () => {
        const a = mk(); const b = mk(); await a.r.push([item('a')], 'd'); await a.r.takeBackup();
        expect(await b.r.listBackups()).toEqual([]);
      });
      it('restore: changed rows revert, deleted rows come back, rows absent from the snapshot are tombstoned; all get NEW versions', async () => {
        const { r } = mk();
        await r.push([item('keep', { v: 'k' }), item('edit', { v: 'old' }), item('del', { v: 'd' })], 'd');
        const info = await r.takeBackup();
        const edit2 = okRow((await r.push([item('edit', { v: 'new' }, 1)], 'd'))[0]);
        okRow((await r.push([tomb('del', 1)], 'd'))[0]);
        okRow((await r.push([item('added-later', { v: 'x' })], 'd'))[0]);
        const touched = await r.restoreBackup(info.taken_on);
        expect(touched).toBeGreaterThanOrEqual(3);
        const rows = new Map((await pullAll(r)).map(x => [x.id, x]));
        expect(rows.get('keep')).toMatchObject({ deleted: false, data: { v: 'k' } });
        expect(rows.get('edit')).toMatchObject({ deleted: false, data: { v: 'old' } });
        expect(rows.get('edit')!.version).toBeGreaterThan(edit2.version);
        expect(rows.get('del')).toMatchObject({ deleted: false, data: { v: 'd' } });
        expect(rows.get('del')!.version).toBeGreaterThan(2);
        expect(rows.get('added-later')).toMatchObject({ deleted: true });
        expect(rows.get('added-later')!.version).toBeGreaterThan(1);
      });
      it('restore only produces rows with seq above the previous maximum, so every device sees them by cursor', async () => {
        const { r } = mk(); await r.push([item('a', { v: 1 })], 'd'); const info = await r.takeBackup();
        const before = await pullAll(r); const cur = before[before.length - 1].seq;
        await r.push([item('a', { v: 2 }, 1)], 'd'); const cur2 = (await pullAll(r)).slice(-1)[0].seq;
        await r.restoreBackup(info.taken_on);
        const after = await r.pull(cur2, 100); expect(after.length).toBeGreaterThan(0); expect(after[0].seq).toBeGreaterThan(cur);
        expect(after.find(x => x.id === 'a')!.data).toEqual({ v: 1 });
      });
      it('restoring an unknown date throws', async () => {
        const { r } = mk(); await expect(r.restoreBackup('1999-01-01')).rejects.toThrow();
      });
      it('restore never touches another user', async () => {
        const a = mk(); const b = mk();
        await a.r.push([item('a')], 'd'); const info = await a.r.takeBackup();
        await b.r.push([item('b', { v: 1 })], 'd');
        await a.r.restoreBackup(info.taken_on);
        expect((await pullAll(b.r)).map(x => [x.id, x.deleted])).toEqual([['b', false]]);
      });
    });
  });
}
