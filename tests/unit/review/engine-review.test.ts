/* Independent review of the client sync engine. Each FINDING test asserts the DESIRED behaviour: a failing test is a bug.
   Tests named "VERIFIED" pin properties that hold today. Tests named "DOC" document behaviour without asserting a fix. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MemStorage, MemStore, TestClock, USER, converge, expectConverged, flushMicrotasks, makeMutex, task, world } from '../engine/harness';
import { FakeRemote, FakeServer } from '../fakeRemote';
import { createSyncEngine } from '../../../src/sync/engine';
import { legacyKey, metaKey } from '../../../src/sync/meta';
import { validateItem } from '../../../src/lib/validate';
import { zustandStoreAdapter } from '../../../src/lib/storeAdapter';
import { useStore } from '../../../src/store';
import { rehydrateOnStorage } from '../../../src/lib/crossTab';
import { seed } from '../../../src/seed';
import { addDays, today } from '../../../src/lib/dates';
import type { Item, PushItem, PushResult, Remote, RemoteRow } from '../../../src/sync/types';

/** a task that passes the REAL validator (the harness `task()` helper lacks context/effort/stat/tags) */
const vtask = (id: string): Item => ({ id, title: `title ${id}`, done: false, context: 'personal', tags: [], effort: 1, stat: 'mind' });
const many = (n: number, mk: (i: number) => Item) => Array.from({ length: n }, (_, i) => mk(i));

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('FINDING 1 (upgrade): the old client wrote meta/settings WITHOUT an id', () => {
  it('a realistic upgrade (DB holds old-client rows, device holds the old ledger-sync-<uid> snapshot) settles and syncs settings', async () => {
    const w = world();
    const oldSettings = { theme: 'dark', skin: 'canopy', wakeTime: '06:30', name: 'Dinesh' };           // what src/sync.ts@HEAD~ pushed: data = st.settings (no id)
    w.server.injectRow(USER, { collection: 'meta', id: 'settings', data: oldSettings });
    w.server.injectRow(USER, { collection: 'tasks', id: 't1', data: vtask('t1') });
    const local = { id: 'settings', theme: 'dark', skin: 'canopy', wakeTime: '06:30', name: 'Dinesh', settledThrough: '2026-01-01' };
    const d = w.make('A', { validate: (c, i) => validateItem(c, i), initial: { meta: [local], tasks: [vtask('t1')] } });
    d.storage.setItem(legacyKey(USER), JSON.stringify([['tasks/t1', JSON.stringify(vtask('t1'))], ['meta/settings', JSON.stringify(oldSettings)]]));
    d.engine.start(); await d.sync(); await d.sync();
    const pushesAfterBoot = w.server.calls.push;
    await w.clock.advance(60_000);                                           // 12 retry slots of 5 s
    const q = (d.engine as unknown as { quarantine(): { invalidRows: unknown[] } }).quarantine();
    // desired: the id-less legacy settings row is accepted (or upgraded), nothing quarantined, nothing pending, no retry storm
    expect(q.invalidRows, 'legacy meta/settings quarantined as "failed validation"').toHaveLength(0);
    expect(d.engine.info().pending, 'settings stay pending forever').toBe(0);
    expect(w.server.calls.push - pushesAfterBoot, 'retries every 5 s forever').toBeLessThan(3);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('FINDING 2 (race): the realtime echo of OUR OWN write overwrites a keystroke typed while the push was in flight', () => {
  /** A Remote that, like Supabase realtime, echoes our own accepted write back to us BEFORE the RPC response is delivered, and runs `during` in that window. */
  class EchoRemote implements Remote {
    onRow: (r: RemoteRow) => void = () => {}; during: (() => void) | null = null;
    constructor(private inner: FakeRemote) {}
    pull(s: number, l?: number) { return this.inner.pull(s, l); }
    async push(items: PushItem[], dev: string): Promise<PushResult[]> {
      const res = await this.inner.push(items, dev);
      this.during?.(); this.during = null;
      for (const r of res) if (r.row) this.onRow(r.row);
      return res;
    }
    subscribe(onRow: (r: RemoteRow) => void, onStatus: (s: 'live' | 'down') => void) { this.onRow = onRow; onStatus('live'); return () => {}; }
    listBackups() { return this.inner.listBackups(); } takeBackup() { return this.inner.takeBackup(); } restoreBackup(d: string) { return this.inner.restoreBackup(d); }
  }
  it('text typed during the push survives the echo of the push', async () => {
    const server = new FakeServer(); const clock = new TestClock(); server.clock = clock.now;
    const store = new MemStore({ journal: [{ id: 'j1', body: 'v0' }] }); const storage = new MemStorage();
    const remote = new EchoRemote(new FakeRemote(server, USER, 'A'));
    const eng = createSyncEngine({ remote, store, storage, userId: USER, deviceId: 'A', now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    eng.start(); await eng.syncNow(); await flushMicrotasks();
    store.data.journal = [{ id: 'j1', body: 'v1' }]; store.notify();               // edit 1, pushed
    remote.during = () => { store.data.journal = [{ id: 'j1', body: 'v1 plus more typing' }]; store.notify(); }; // edit 2 typed while the RPC is in flight
    await eng.syncNow(); await flushMicrotasks();
    for (let i = 0; i < 4; i++) { await eng.syncNow(); await clock.advance(10_000); }
    expect(store.data.journal[0]).toMatchObject({ body: 'v1 plus more typing' });
    expect(server.getRow(USER, 'journal', 'j1')!.data).toMatchObject({ body: 'v1 plus more typing' });
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('FINDING 3 (cache-loss guard false positive): intentional bulk deletes are silently undone', () => {
  it('removing 25 of 30 tasks (e.g. restoring a smaller backup file, "clear all") produces tombstones and stays deleted', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: many(30, (i) => task(`t${i}`)) } }).boot(); await a.syncUntilClean();
    a.store.data.tasks = a.store.data.tasks.slice(0, 5); a.store.notify();       // importAll({tasks: first 5}) is exactly this single write
    await a.syncUntilClean();
    expect(w.server.liveRows(USER, 'tasks').length, 'server still has the tasks the user deleted').toBe(5);
    expect(a.items('tasks').length, 'deleted tasks came back locally').toBe(5);
  });
  it('the same deletion made in chunks of 19 works (shows the guard is the cause, and that the user is never told)', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: many(30, (i) => task(`t${i}`)) } }).boot(); await a.syncUntilClean();
    a.store.data.tasks = a.store.data.tasks.slice(19); a.store.notify(); await a.syncUntilClean();
    expect(w.server.liveRows(USER, 'tasks')).toHaveLength(11);
  });
  it('a backup restore that both removes 25 items and re-creates one produces the file content everywhere', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: many(30, (i) => task(`t${i}`)) } }).boot(); await a.syncUntilClean(); const b = await w.make('B').boot();
    a.store.data.tasks = [task('t0'), task('fresh-from-file')]; a.store.notify(); await a.syncUntilClean(); await b.syncUntilClean();
    expect(b.items('tasks').map((x) => x.id).sort()).toEqual(['fresh-from-file', 't0']);
  });
});

describe('FINDING 4 (cache-loss guard): rebuilding drops the base of EVERY item, so unsynced edits of other items are silently overwritten', () => {
  it('an offline edit survives a guard-triggered rebuild (or is at least in the conflict log)', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: many(30, (i) => task(`t${i}`)) } }).boot(); await a.syncUntilClean();
    a.offline(); a.update('tasks', 't0', { title: 'important offline edit' });
    a.store.data.tasks = a.store.data.tasks.filter((t) => t.id === 't0'); a.store.notify();   // + a bulk delete that trips the guard
    a.online(); await a.syncUntilClean();
    const kept = a.get('tasks', 't0')?.title === 'important offline edit' || a.conflicts().some((c) => JSON.stringify(c.local ?? '').includes('important offline edit'));
    expect(kept, 'the offline edit vanished without a trace').toBe(true);
  });
});

describe('FINDING 5 (cache-loss guard false negative): wiped store + surviving metadata pushes mass deletes when < 20 items', () => {
  it('store reset to seed (corrupt blob) while the sync metadata survives must not tombstone the user data', async () => {
    const w = world(); const storage = new MemStorage();
    const a = await w.make('A', { storage, initial: { tasks: many(12, (i) => task(`t${i}`)), habits: [{ id: 'seedh', name: 'Run' }] } }).boot(); await a.syncUntilClean(); a.stop();
    // the persisted blob was unreadable -> store starts from the seed again; localStorage meta for sync is intact
    const b = w.make('A2', { storage, initial: { habits: [{ id: 'seedh', name: 'Run' }], blocks: [{ id: 'b1' }] } });
    b.engine.start(); await b.sync(); await b.syncUntilClean();
    expect(w.server.liveRows(USER, 'tasks'), 'server rows were tombstoned by a cache wipe').toHaveLength(12);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('FINDING 6: the sync metadata is NOT disposable while edits are unsynced', () => {
  it('losing the metadata (quota failure / eviction) with an unsynced local edit must not silently drop the edit', async () => {
    const w = world(); const storage = new MemStorage(); const store = new MemStore({ tasks: [task('t1', { note: 'old' })] });
    const a = await w.make('A', { storage, store }).boot(); await a.syncUntilClean(); a.offline();
    a.update('tasks', 't1', { note: 'written offline, only in the browser' }); a.stop();
    storage.removeItem(metaKey(USER));                                              // meta lost, the persisted store survived
    const b = w.make('A', { storage: new MemStorage(), store }); b.online(); b.engine.start(); await b.sync(); await b.syncUntilClean();
    const survived = w.server.getRow(USER, 't'.concat('asks'), 't1')!.data as Item;
    const logged = b.conflicts().some((c) => JSON.stringify(c.local ?? '').includes('written offline'));
    expect(survived.note === 'written offline, only in the browser' || logged, 'edit overwritten by the server copy, no conflict entry').toBe(true);
  });
  it('VERIFIED: setItem throwing (quota) for the meta never stops syncing in the running session', async () => {
    const w = world(); const storage = new MemStorage(); storage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    const a = await w.make('A', { storage }).boot(); a.add('tasks', task('q1')); await a.syncUntilClean();
    expect(w.server.getRow(USER, 'tasks', 'q1')).toBeDefined(); expect(a.engine.info().status).toBe('synced');
  });
  it('DOC: the meta blob holds a full canonical copy of every item (about 2x the localStorage footprint, quota hits twice as early)', async () => {
    const w = world(); const storage = new MemStorage(); const items = many(50, (i) => ({ id: `j${i}`, date: '2026-01-01', body: 'x'.repeat(10_000), kind: 'daily' }));
    const a = await w.make('A', { storage, initial: { journal: items } }).boot(); await a.syncUntilClean();
    const metaBytes = storage.getItem(metaKey(USER))!.length; const dataBytes = JSON.stringify(items).length;
    expect(metaBytes / dataBytes, `meta=${metaBytes} data=${dataBytes}`).toBeLessThan(0.5);   // FAILS: ratio is ~1.0
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('FINDING 7 (multi-tab): two tabs share the sync metadata but not their in-memory store', () => {
  it('a stale tab must not push its old copy over the other tab\'s acknowledged edit', async () => {
    const w = world(); const storage = new MemStorage(); const lock = makeMutex();
    const t1 = await w.make('T', { storage, withLock: lock.withLock, initial: { tasks: [task('x', { title: 'orig' })] } }).boot();
    const t2 = await w.make('T', { storage, withLock: lock.withLock, initial: { tasks: [task('x', { title: 'orig' })] } }).boot();
    await t1.syncUntilClean(); await t2.syncUntilClean();
    w.server.dropRealtime();                                       // realtime is at-most-once; a hidden tab may miss rows
    for (let i = 0; i < 6; i++) { t1.update('tasks', 'x', { title: i < 5 ? `tab 1 draft ${i}` : 'edited in tab 1' }); await t1.syncUntilClean(); }   // tab 1 saves the shared meta more often than tab 2
    await t2.sync();                                               // tab 2 reloads the shared meta (higher rev), sees base = tab 1's text, its stale memory != base -> "local edit"
    expect(w.server.getRow(USER, 'tasks', 'x')!.data, 'tab 2 pushed its stale copy on top of tab 1').toMatchObject({ title: 'edited in tab 1' });
    await t2.sync(); await t1.sync();
    expect(t2.get('tasks', 'x'), 'tab 2 memory never converges').toMatchObject({ title: 'edited in tab 1' });
  });
});

describe('FINDING 8 (multi-tab): zustand persist writes the WHOLE blob from each tab\'s memory (last writer wins)', () => {
  it('with the storage-event rehydrate (src/lib/crossTab.ts) tab B\'s write keeps tab A\'s item', () => {
    const mem = new Map<string, string>(); type Fn = (e: { key: string | null }) => void; const listeners: Record<'A' | 'B', Fn[]> = { A: [], B: [] };
    const storageOf = (me: 'A' | 'B') => ({
      getItem: (k: string) => mem.get(k) ?? null, removeItem: (k: string) => void mem.delete(k),
      setItem: (k: string, v: string) => { mem.set(k, v); for (const o of ['A', 'B'] as const) if (o !== me) listeners[o].forEach((f) => f({ key: k })); }, // the browser tells the OTHER tabs
    });
    const mk = (me: 'A' | 'B') => {
      const store = createStore<{ tasks: string[]; add: (t: string) => void }>()(persist((set) => ({ tasks: [], add: (t) => set((s) => ({ tasks: [...s.tasks, t] })) }), { name: 'life-tracker-v1', storage: createJSONStorage(() => storageOf(me)) }));
      rehydrateOnStorage({ addEventListener: (_t, cb) => void listeners[me].push(cb) }, 'life-tracker-v1', store);
      return store;
    };
    const tabA = mk('A'); const tabB = mk('B');
    tabA.getState().add('offline-edit-in-A'); tabB.getState().add('offline-edit-in-B');
    expect(JSON.parse(mem.get('life-tracker-v1')!).state.tasks as string[]).toEqual(['offline-edit-in-A', 'offline-edit-in-B']);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('FINDING 9: sign-out / sign-in as another user keeps the previous user\'s data in the store', () => {
  it('user B\'s cloud account must not receive user A\'s data', async () => {
    const w = world(); const store = new MemStore({ tasks: [task('private-of-A')] });
    const a = await w.make('A', { store }).boot(); await a.syncUntilClean(); a.stop();
    const B = '22222222-2222-4222-8222-222222222222';
    const b = w.make('B', { store, user: B }); b.engine.start(); await b.sync(); await b.syncUntilClean();
    expect(w.server.liveRows(B), 'A\'s private task was uploaded to B\'s account').toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('FINDING 10: first sync on a fresh device with the REAL store (seed settledThrough = yesterday)', () => {
  beforeEach(() => { useStore.setState({ ...seed(), xp: [], habitLogs: [], wake: [], rejections: [], oneLogs: [], kv: [] } as never); });
  it('the server\'s older settledThrough wins so the missed-day penalties are still applied', async () => {
    const server = new FakeServer(); const clock = new TestClock(); server.clock = clock.now;
    const old = addDays(today(), -4);
    server.injectRow(USER, { collection: 'meta', id: 'settings', data: { id: 'settings', theme: 'light', skin: 'canopy', wakeTime: '06:00', name: 'Real', settledThrough: old } });
    const engine = createSyncEngine({ remote: new FakeRemote(server, USER, 'new'), store: zustandStoreAdapter(), storage: new MemStorage(), userId: USER, deviceId: 'new', now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, validate: validateItem });
    engine.start(); await engine.syncNow(); await flushMicrotasks();
    expect(useStore.getState().settings.name).toBe('Real');
    expect(useStore.getState().settledThrough, 'seed date (yesterday) overrode the server date: 3 days of penalties silently skipped').toBe(old);
    engine.stop();
  });
});

describe('FINDING 11: a penalty is not reversed when the day is later logged (typical after offline use on a second device)', () => {
  beforeEach(() => { useStore.setState({ ...seed(), xp: [], habitLogs: [], wake: [], rejections: [], oneLogs: [], kv: [] } as never); });
  it('settle() penalises yesterday; logging yesterday afterwards leaves both the penalty and the credit', () => {
    const s = useStore.getState(); const y = addDays(today(), -1);
    useStore.setState({ settledThrough: addDays(today(), -2) });
    s.settle(); expect(useStore.getState().xp.some((e) => e.ref === `miss:meditate:${y}`)).toBe(true);
    useStore.getState().logHabit('meditate', y, 'full');
    expect(useStore.getState().xp.some((e) => e.ref === `miss:meditate:${y}`), 'penalty for a day that WAS done is still there').toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('FINDING 13: edits made while a push or a pull is awaited', () => {
  it('VERIFIED: an edit typed during a pull await (before the rows are applied) is merged, not overwritten', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1', { note: 'n' })] } }).boot(); await a.syncUntilClean(); const b = await w.make('B').boot();
    w.server.latency = 20; b.update('tasks', 't1', { note: 'B' });
    const p = a.engine.syncNow(); await flushMicrotasks(); a.update('tasks', 't1', { title: 'typed during sync' });
    await p; w.server.latency = 0; await converge([a, b], w.clock, w.server);
    expect(w.server.getRow(USER, 'tasks', 't1')!.data).toMatchObject({ title: 'typed during sync', note: 'B' }); expectConverged([a, b], w.server);
  });
  it('VERIFIED: an item deleted during the push of its edit ends deleted, no duplicate', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1')] } }).boot(); await a.syncUntilClean();
    w.server.latency = 20; a.update('tasks', 't1', { title: 'e' }); const p = a.engine.syncNow(); await flushMicrotasks(); a.remove('tasks', 't1');
    await p; w.server.latency = 0; await a.syncUntilClean();
    expect(w.server.liveRows(USER, 'tasks')).toHaveLength(0); expect(a.items('tasks')).toHaveLength(0);
  });
});

describe('FINDING 14: "gone" drops an edited local item without a conflict entry', () => {
  it('an offline edit to an item whose tombstone was purged server-side is at least recoverable from the conflict log', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1')] } }).boot(); await a.syncUntilClean(); const b = await w.make('B').boot(); await b.syncUntilClean();
    a.offline(); b.remove('tasks', 't1'); await b.syncUntilClean(); w.server.purgeTombstones(USER); a.online();
    a.update('tasks', 't1', { title: 'edited for 90 days offline' }); await a.syncUntilClean();
    expect(a.conflicts().some((c) => JSON.stringify(c.local ?? '').includes('edited for 90')), 'edit silently dropped').toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('verified properties (should keep passing)', () => {
  it('VERIFIED: 20k-row first pull completes, one pending-free state, bounded time', async () => {
    const w = world(); const rows = many(20_000, (i) => ({ id: `k${i}`, value: 'v' + i }));
    for (const r of rows) w.server.injectRow(USER, { collection: 'kv', id: r.id as string, data: r });
    const t0 = Date.now(); const d = await w.make('N').boot();
    const ms = Date.now() - t0;
    expect(d.items('kv')).toHaveLength(20_000); expect(d.engine.info().pending).toBe(0); expect(ms, `took ${ms} ms`).toBeLessThan(20_000);
  });
  it('VERIFIED: unusual ids (unicode, slash, quotes, __proto__, spaces, 200 chars) round trip without collisions', async () => {
    const w = world(); const ids = ['a/b', 'a/b/c', '日本語', '😀', 'q"uote', '__proto__', 'constructor', 'with space', 'x'.repeat(200), 'wake:not-a-date', 'x:ref:with:colons'];
    const a = await w.make('A', { initial: { tasks: ids.map((id) => task(id)) } }).boot(); await a.syncUntilClean(); const b = await w.make('B').boot();
    expect(b.items('tasks').map((t) => t.id).sort()).toEqual([...ids].sort()); expectConverged([a, b], w.server);
  });
  it('VERIFIED: an expired session mid-cycle keeps local edits, reports an error, and resumes when the session is back', async () => {
    const w = world(); const a = await w.make('A').boot(); a.add('tasks', task('t1'));
    w.server.failNext(1, 'push', 0, 'JWT expired'); await a.sync();
    expect(a.engine.info().status).toBe('error'); expect(a.engine.info().error).toMatch(/session expired/i); expect(a.get('tasks', 't1')).toBeDefined();
    await a.syncUntilClean(); expect(w.server.getRow(USER, 'tasks', 't1')).toBeDefined();
  });
  it('VERIFIED: two devices creating the same logical xp event offline (deterministic id) produce one row', async () => {
    const w = world(); const ev = { id: 'x:habit:read:2026-11-10', date: '2026-11-10', stat: 'mind', amount: 15, reason: 'Reading', ref: 'habit:read:2026-11-10' };
    const a = await w.make('A').boot(); const b = await w.make('B').boot(); a.offline(); b.offline(); a.add('xp', ev); b.add('xp', ev);
    await converge([a, b], w.clock, w.server); expect(w.server.liveRows(USER, 'xp')).toHaveLength(1); expectConverged([a, b], w.server);
  });
  it('VERIFIED: legacy random-id habit log + new hl:<habit>:<date> log for the same day collapse to one log (loser tombstoned), xp counted once', async () => {
    useStore.setState({ ...seed(), xp: [], habitLogs: [], wake: [], rejections: [], oneLogs: [], kv: [] } as never);
    const server = new FakeServer(); const clock = new TestClock(); server.clock = clock.now; const d = '2026-11-10';
    server.injectRow(USER, { collection: 'habitLogs', id: 'a1b2-legacy', data: { id: 'a1b2-legacy', habitId: 'read', date: d, level: 'full' } });
    server.injectRow(USER, { collection: 'habitLogs', id: `hl:read:${d}`, data: { id: `hl:read:${d}`, habitId: 'read', date: d, level: 'full' } });
    server.injectRow(USER, { collection: 'xp', id: 'legacy-xp', data: { id: 'legacy-xp', date: d, stat: 'mind', amount: 15, reason: 'Reading', ref: `habit:read:${d}` } });
    server.injectRow(USER, { collection: 'xp', id: `x:habit:read:${d}`, data: { id: `x:habit:read:${d}`, date: d, stat: 'mind', amount: 15, reason: 'Reading', ref: `habit:read:${d}` } });
    const engine = createSyncEngine({ remote: new FakeRemote(server, USER, 'n'), store: zustandStoreAdapter(), storage: new MemStorage(), userId: USER, deviceId: 'n', now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, validate: validateItem });
    engine.start(); await engine.syncNow(); await engine.syncNow(); await flushMicrotasks();
    expect(useStore.getState().habitLogs.filter((l) => l.date === d)).toHaveLength(1); expect(useStore.getState().xp.filter((e) => e.ref === `habit:read:${d}`)).toHaveLength(1);
    expect(server.liveRows(USER, 'habitLogs')).toHaveLength(1); expect(server.liveRows(USER, 'xp')).toHaveLength(1); engine.stop();
  });
  it('VERIFIED: numbers 1 vs 1.0, key order and Date strings do not cause phantom edits after a server round trip', async () => {
    const w = world(); const a = await w.make('A', { initial: { body: [{ id: 'b1', date: '2026-11-01', weightKg: 80.0, measurements: { z: 1, a: 1.0 } }] } }).boot(); await a.syncUntilClean();
    const b = await w.make('B').boot(); expect(b.engine.info().pending).toBe(0); expect(a.engine.info().pending).toBe(0); expect(w.server.getRow(USER, 'body', 'b1')!.version).toBe(1);
  });
});
