import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../../src/sync/types';
import { USER, converge, expectConverged, flushMicrotasks, makeMutex, task, world } from './harness';

describe('engine: failures, retries, status', () => {
  it('network failure in the middle of a multi-batch push resumes without duplicates or losses', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('seed')] } }).boot(); await a.syncUntilClean();
    a.addMany('tasks', Array.from({ length: 1200 }, (_, i) => task(`n${i}`)));
    w.server.failNext(1, 'push', 1); // first batch goes through, the second fails
    await a.sync();
    expect(a.engine.info().status).toMatch(/error|offline/); expect(a.engine.info().pending).toBeGreaterThan(0); expect(a.engine.info().pending).toBeLessThan(1200);
    await a.syncUntilClean();
    expect(w.server.liveRows(USER)).toHaveLength(1201); expect(w.server.allRows(USER).every(r => r.version === 1), 'no item written twice').toBe(true);
    expectConverged([a], w.server);
  });

  it('server applied the write but the response was lost: the retry is idempotent (no duplicate, no version churn, no conflict)', async () => {
    const w = world(); const a = await w.make('A').boot();
    a.add('tasks', task('t1')); w.server.loseResponseNext(1); await a.sync();
    expect(w.server.getRow(USER, 'tasks', 't1')!.version).toBe(1);
    expect(a.engine.info().pending, 'client does not know the write was applied').toBe(1);
    await a.syncUntilClean();
    expect(a.engine.info().pending).toBe(0); expect(w.server.liveRows(USER)).toHaveLength(1);
    expect(w.server.getRow(USER, 'tasks', 't1')!.version, 'retrying an already applied write must not bump the version').toBe(1);
    expect(a.conflicts()).toEqual([]); expectConverged([a], w.server);
  });
  it('lost response on an EDIT and on a DELETE is also idempotent', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1'), task('t2'), task('keep')] } }).boot(); await a.syncUntilClean();
    a.update('tasks', 't1', { title: 'edited' }); a.remove('tasks', 't2'); w.server.loseResponseNext(1); await a.sync(); await a.syncUntilClean();
    expect(w.server.getRow(USER, 'tasks', 't1')).toMatchObject({ version: 2, data: { title: 'edited' } });
    expect(w.server.getRow(USER, 'tasks', 't2')).toMatchObject({ version: 2, deleted: true });
    expect(a.conflicts()).toEqual([]); expectConverged([a], w.server);
  });

  it('network failure in the middle of a paged pull resumes without duplicates or losses', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: Array.from({ length: 2500 }, (_, i) => task(`t${i}`)) } }).boot(); await a.syncUntilClean();
    const b = w.make('B'); w.server.failNext(1, 'pull', 1); // page 1 ok, page 2 fails
    b.engine.start(); await b.sync();
    expect(b.engine.info().status).toMatch(/error|offline/);
    await b.syncUntilClean();
    expect(b.items('tasks')).toHaveLength(2500); expectConverged([a, b], w.server);
  });

  it('a pull failure after pushing does not lose or repeat the push', async () => {
    const w = world(); const a = await w.make('A').boot(); a.add('tasks', task('t1')); w.server.failNext(1, 'pull', 0);
    // fail the pull that follows the push: the first pull of the cycle is the initial one (already done in boot), so the next pull comes after the push
    await a.sync(); await a.syncUntilClean(); expect(w.server.liveRows(USER)).toHaveLength(1); expect(w.server.getRow(USER, 'tasks', 't1')!.version).toBe(1); expectConverged([a], w.server);
  });

  it('offline: status offline/error, local edits are kept and counted, then everything uploads when the network is back', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1')] } }).boot(); await a.syncUntilClean();
    a.offline(); a.update('tasks', 't1', { title: 'offline edit' }); a.add('tasks', task('t2'));
    await a.sync(); const i = a.engine.info();
    expect(['offline', 'error']).toContain(i.status); expect(i.pending).toBe(2); expect(i.error).toBeTruthy();
    expect(a.get('tasks', 't1')).toMatchObject({ title: 'offline edit' });
    a.online(); await w.clock.advance(5 * 60_000); // the engine retries on its own (backoff timer)
    expect(a.engine.info().status).toBe('synced'); expect(a.engine.info().pending).toBe(0); expect(a.engine.info().lastSyncAt).toBeTruthy();
    expect(w.server.getRow(USER, 'tasks', 't2')).toBeDefined();
  });

  it('retries back off exponentially instead of hammering a dead server', async () => {
    const w = world(); const a = await w.make('A').boot(); a.add('tasks', task('t1')); a.offline();
    await a.sync(); const base = w.server.calls.push + w.server.calls.pull;
    await w.clock.advance(60_000); const first = w.server.calls.push + w.server.calls.pull - base;
    await w.clock.advance(10 * 60_000); const later = w.server.calls.push + w.server.calls.pull - base - first;
    expect(first, 'attempts in the first minute').toBeLessThanOrEqual(8); expect(later, 'attempts in the next 10 minutes').toBeLessThanOrEqual(10);
    a.online(); await w.clock.advance(6 * 60_000); expect(a.engine.info().pending).toBe(0);
  });

  it('subscribe() reports status transitions and pending counts; unsubscribe stops notifications', async () => {
    const w = world(); const a = w.make('A'); const seen: string[] = []; let pend: number[] = [];
    const off = a.engine.subscribe(i => { seen.push(i.status); pend.push(i.pending); });
    await a.boot(); expect(seen).toContain('synced');
    a.add('tasks', task('t1')); expect(pend[pend.length - 1]).toBe(1);
    await a.syncUntilClean(); expect(pend[pend.length - 1]).toBe(0);
    off(); const n = seen.length; a.add('tasks', task('t2')); await a.syncUntilClean(); expect(seen.length).toBe(n);
  });

  it('pending count is accurate: adds, edits, deletes, and goes back to 0 after sync', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1'), task('t2'), task('t3')] } }).boot(); await a.syncUntilClean();
    expect(a.engine.info().pending).toBe(0);
    a.add('tasks', task('n1')); expect(a.engine.info().pending).toBe(1);
    a.update('tasks', 't1', { title: 'x' }); expect(a.engine.info().pending).toBe(2);
    a.update('tasks', 't1', { title: 'y' }); expect(a.engine.info().pending, 'two edits of one item are one pending change').toBe(2);
    a.remove('tasks', 't2'); expect(a.engine.info().pending).toBe(3);
    a.offline(); await a.sync(); expect(a.engine.info().pending).toBe(3); a.online();
    await a.syncUntilClean(); expect(a.engine.info().pending).toBe(0);
    a.add('tasks', task('n2')); a.remove('tasks', 'n2'); await a.syncUntilClean();
    expect(w.server.getRow(USER, 'tasks', 'n2')?.deleted ?? true, 'an item created and deleted before any sync must not stay live').toBe(true);
    expect(a.engine.info().pending).toBe(0);
  });

  it('flush() resolves once nothing is pending (it pushes by itself)', async () => {
    const w = world(); const a = await w.make('A').boot(); a.add('tasks', task('t1')); a.add('tasks', task('t2'));
    await a.engine.flush(); expect(a.engine.info().pending).toBe(0); expect(w.server.liveRows(USER)).toHaveLength(2);
    await a.engine.flush(); // nothing pending: resolves immediately
  });
  it('flush() rejects when offline and does not hang', async () => {
    const w = world(); const a = await w.make('A').boot(); a.add('tasks', task('t1')); a.offline();
    await expect(a.engine.flush()).rejects.toThrow(); expect(a.engine.info().pending).toBe(1); expect(a.get('tasks', 't1')).toBeDefined();
  });
  it('flush() rejects on timeout when the server never answers', async () => {
    const w = world(); const a = await w.make('A').boot(); w.server.latency = 10 * 60_000; a.add('tasks', task('t1'));
    const p = a.engine.flush().then(() => 'resolved', (e: Error) => `rejected: ${e.message}`);
    await w.clock.advance(LIMITS.maxBatch * 1000); expect(await p).toMatch(/^rejected/);
    w.server.latency = 0;
  });

  it('rejected items are not retried in a loop, do not block other items, and are surfaced', async () => {
    const w = world(); const a = await w.make('A').boot();
    a.add('tasks', { id: 'huge', blob: 'x'.repeat(LIMITS.maxItemBytes + 100) }); a.add('tasks', task('fine'));
    await a.syncUntilClean(3); const sent = w.server.calls.pushItems;
    expect(w.server.getRow(USER, 'tasks', 'fine')).toBeDefined(); expect(w.server.getRow(USER, 'tasks', 'huge')).toBeUndefined();
    for (let i = 0; i < 4; i++) { await a.sync(); await w.clock.advance(60_000); }
    expect(w.server.calls.pushItems, 'the refused item must not be re-sent').toBe(sent);
    expect(a.get('tasks', 'huge'), 'the local copy is kept').toBeDefined();
    expect(a.engine.info().error ?? '').toMatch(/refused|reject|not synced/i);
    a.update('tasks', 'huge', { blob: 'small now' }); await a.syncUntilClean(); expect(w.server.getRow(USER, 'tasks', 'huge')).toBeDefined(); // editing makes it eligible again
  });

  it("'gone' after the server purged the tombstone: an edited local item is re-created (logged), an unedited one is dropped; nothing loops", async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1'), task('t2')] } }).boot(); await a.syncUntilClean();
    const b = await w.make('B').boot(); b.offline(); b.update('tasks', 't1', { title: 'stale edit' });
    a.remove('tasks', 't1'); await a.syncUntilClean(); expect(w.server.purgeTombstones()).toBe(1);
    b.online(); await b.syncUntilClean(); await a.syncUntilClean();
    expect(b.get('tasks', 't1')).toMatchObject({ title: 'stale edit' }); expect(w.server.getRow(USER, 'tasks', 't1')).toMatchObject({ deleted: false, version: 1 });
    expect(b.conflicts().some((c) => c.id === 't1' && c.kind === 'deleted-remotely')).toBe(true);
    const calls = w.server.calls.push; await b.sync(); await a.sync(); expect(w.server.calls.push).toBe(calls);
    expectConverged([a, b], w.server);
  });

  it('invalid server rows are quarantined, never applied, and do not block valid rows or repeat forever', async () => {
    const w = world(); const validate = (c: string, it: unknown) => !!it && typeof it === 'object' && typeof (it as { title?: unknown }).title === 'string';
    const a = await w.make('A').boot();
    w.server.injectRow(USER, { collection: 'tasks', id: 'bad1', data: { title: 42 } });
    w.server.injectRow(USER, { collection: 'tasks', id: 'bad2', data: 'a string' });
    w.server.injectRow(USER, { collection: 'tasks', id: 'bad3', data: [1, 2] });
    w.server.injectRow(USER, { collection: 'tasks', id: 'good', data: { id: 'good', title: 'ok' } });
    w.server.injectRow(USER, { collection: 'not_a_collection', id: 'x', data: { title: 'x' } });
    const b = w.make('B', { validate }); b.engine.start(); await b.sync(); await b.syncUntilClean();
    expect(b.items('tasks').map(x => x.id)).toEqual(['good']);
    expect(b.engine.info().pending, 'quarantined rows must not generate local changes').toBe(0);
    const pulls = w.server.calls.pull; await b.sync(); expect(b.items('tasks')).toHaveLength(1); expect(w.server.calls.pull - pulls).toBeLessThan(5);
    await a.sync(); // default validation still rejects non-objects
    expect(a.items('tasks').map(x => x.id)).not.toContain('bad2'); expect(a.items('tasks').map(x => x.id)).not.toContain('bad3');
  });
});

describe('engine: cache is disposable', () => {
  it('a device with a wiped local cache rebuilds identically from the server: zero pending, no duplicates', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: Array.from({ length: 50 }, (_, i) => task(`t${i}`)), habits: [{ id: 'h1', name: 'Run' }], wake: [{ date: '2026-01-01', time: '07:00' }], meta: [{ id: 'settings', theme: 'dark' }] } }).boot(); await a.syncUntilClean();
    a.update('tasks', 't3', { title: 'edited' }); a.remove('tasks', 't4'); await a.syncUntilClean();
    const before = a.snapshot(); const seq = w.server.seq;
    const a2 = a.wiped(); await a2.boot(); await a2.syncUntilClean();
    expect(a2.engine.info().pending).toBe(0); expect(w.server.seq, 'rebuilding the cache must not write to the server').toBe(seq);
    expect(a2.snapshot()).toEqual(before); expectConverged([a2], w.server);
  });
  it('wiping only the sync metadata (items kept locally) neither duplicates nor changes server data', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1'), task('t2')] } }).boot(); await a.syncUntilClean(); const seq = w.server.seq; const snap = JSON.stringify(a.snapshot());
    const a2 = w.make('A', { store: a.store }); await a2.boot(); await a2.syncUntilClean();
    expect(JSON.stringify(a2.snapshot())).toBe(snap); expect(w.server.seq, 'identical data must not be re-written').toBe(seq); expect(a2.engine.info().pending).toBe(0);
  });
  it('wiping the local store while the sync metadata survives does NOT delete the server data', async () => {
    const w = world(); const items = Array.from({ length: 30 }, (_, i) => task(`t${i}`));
    const a = await w.make('A', { initial: { tasks: items } }).boot(); await a.syncUntilClean();
    const a2 = w.make('A', { storage: a.storage }); await a2.boot(); await a2.syncUntilClean(); // empty store, old metadata
    expect(w.server.liveRows(USER)).toHaveLength(30); expect(a2.items('tasks')).toHaveLength(30);
  });
  it('resetLocalCache() rebuilds the store from the server and leaves nothing pending', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1'), task('t2')], habits: [{ id: 'h', name: 'x' }] } }).boot(); await a.syncUntilClean();
    const b = await w.make('B').boot(); b.update('tasks', 't1', { title: 'from B' }); await b.syncUntilClean();
    await a.engine.resetLocalCache(); await a.syncUntilClean();
    expect(a.get('tasks', 't1')).toMatchObject({ title: 'from B' }); expect(a.items('tasks')).toHaveLength(2); expect(a.engine.info().pending).toBe(0); expectConverged([a, b], w.server);
  });
});

describe('engine: realtime, polling, tabs', () => {
  it('realtime drop falls back to polling and catches up; realtime recovery flips live back', async () => {
    const w = world(); const a = await w.make('A').boot(); const b = await w.make('B').boot(); await w.clock.advance(1000);
    expect(b.engine.info().live).toBe(true);
    w.server.dropRealtime(); await flushMicrotasks(); expect(b.engine.info().live).toBe(false);
    a.add('tasks', task('missed')); await w.clock.advance(5000); expect(b.get('tasks', 'missed'), 'not yet: realtime is down').toBeUndefined();
    await w.clock.advance(60_000); expect(b.get('tasks', 'missed'), 'polling while realtime is down').toBeDefined();
    w.server.restoreRealtime(); await w.clock.advance(1000); expect(b.engine.info().live).toBe(true);
    a.add('tasks', task('live-again')); await w.clock.advance(5000); expect(b.get('tasks', 'live-again')).toBeDefined(); expectConverged([a, b], w.server);
  });
  it('realtime rows delivered late, duplicated or out of order are harmless', async () => {
    const w = world(); w.server.autoDeliver = false; const a = await w.make('A').boot(); const b = await w.make('B').boot();
    a.add('tasks', task('t1')); await a.syncUntilClean(); a.update('tasks', 't1', { title: 'v2' }); await a.syncUntilClean(); a.update('tasks', 't1', { title: 'v3' }); await a.syncUntilClean();
    await b.sync(); w.server.deliverPending(); w.server.deliverPending();
    expect(b.get('tasks', 't1')).toMatchObject({ title: 'v3' }); expect(b.items('tasks')).toHaveLength(1); expect(b.engine.info().pending).toBe(0); expectConverged([a, b], w.server);
  });
  it('a stale realtime row (older version than the local copy) never rolls the item back', async () => {
    const w = world(); w.server.autoDeliver = false; const a = await w.make('A').boot(); const b = await w.make('B').boot();
    a.add('tasks', task('t1')); await a.syncUntilClean(); a.update('tasks', 't1', { title: 'v2' }); await a.syncUntilClean();
    await b.sync(); expect(b.get('tasks', 't1')).toMatchObject({ title: 'v2' });
    w.server.deliverPending(); expect(b.get('tasks', 't1')).toMatchObject({ title: 'v2' }); expect(b.engine.info().pending).toBe(0);
  });
  it('realtime rows arriving while the local item has unsynced edits are merged, not overwritten', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1', { note: 'n' })] } }).boot(); await a.syncUntilClean(); const b = await w.make('B').boot();
    w.server.autoDeliver = false; b.update('tasks', 't1', { note: 'B note' }); a.update('tasks', 't1', { title: 'A title' }); await a.syncUntilClean();
    w.server.deliverPending(); await flushMicrotasks(); await b.syncUntilClean(); await a.syncUntilClean();
    for (const d of [a, b]) expect(d.get('tasks', 't1')).toMatchObject({ title: 'A title', note: 'B note' }); expectConverged([a, b], w.server);
  });

  it('syncNow() calls never run concurrently inside withLock, and two tabs sharing a lock converge', async () => {
    const w = world(); const lock = makeMutex(); const tab1 = await w.make('T1', { withLock: lock.withLock }).boot(); const tab2 = await w.make('T1', { withLock: lock.withLock }).boot();
    tab1.add('tasks', task('from1')); tab2.add('tasks', task('from2'));
    await Promise.all([tab1.sync(), tab2.sync(), tab1.sync(), tab2.sync(), tab1.sync()]);
    await converge([tab1, tab2], w.clock, w.server);
    expect(lock.stats.calls).toBeGreaterThan(0); expect(lock.stats.maxActive).toBe(1);
    expect(w.server.liveRows(USER).map(r => r.id).sort()).toEqual(['from1', 'from2']); expect(w.server.allRows(USER).every(r => r.version === 1)).toBe(true);
    expectConverged([tab1, tab2], w.server);
  });
  it('overlapping syncNow() calls on one engine coalesce into consistent state (no duplicate writes)', async () => {
    const w = world(); const a = await w.make('A').boot(); a.addMany('tasks', Array.from({ length: 20 }, (_, i) => task(`t${i}`)));
    await Promise.all(Array.from({ length: 6 }, () => a.engine.syncNow())); await a.syncUntilClean();
    expect(w.server.allRows(USER).every(r => r.version === 1)).toBe(true); expect(w.server.calls.pushItems).toBe(20);
  });
  it('a change made WHILE a push is in flight is not lost', async () => {
    const w = world(); const a = await w.make('A').boot(); w.server.latency = 50; a.add('tasks', task('t1'));
    const p = a.engine.syncNow(); await flushMicrotasks(); a.add('tasks', task('during')); a.update('tasks', 't1', { title: 'edited mid-flight' });
    await w.clock.advance(0); w.server.latency = 0; await p.catch(() => {}); await a.syncUntilClean();
    expect(w.server.getRow(USER, 'tasks', 'during')).toBeDefined(); expect(w.server.getRow(USER, 'tasks', 't1')!.data).toMatchObject({ title: 'edited mid-flight' }); expectConverged([a], w.server);
  });
  it('stop() halts timers and subscriptions: later edits are not pushed', async () => {
    const w = world(); const a = await w.make('A').boot(); a.stop(); a.add('tasks', task('t1')); await w.clock.advance(10 * 60_000);
    expect(w.server.liveRows(USER)).toHaveLength(0); expect(w.clock.pendingTimers()).toBe(0);
  });
});
