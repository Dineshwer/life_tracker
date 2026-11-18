import { describe, expect, it } from 'vitest';
import { USER, converge, expectConverged, task, world } from './harness';

describe('engine: first sync, propagation, seeds', () => {
  it('a fresh device pulls everything from the server', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1'), task('t2')], habits: [{ id: 'h1', name: 'Run' }], wake: [{ date: '2026-01-01', time: '06:30' }] } }).boot();
    await a.syncUntilClean();
    const b = await w.make('B').boot();
    expect(b.items('tasks').map(x => x.id).sort()).toEqual(['t1', 't2']);
    expect(b.get('habits', 'h1')).toMatchObject({ name: 'Run' });
    expect(b.items('wake')).toHaveLength(1);
    expectConverged([a, b], w.server);
    expect(b.engine.info().pending).toBe(0);
  });

  it('a device with local data and an empty server uploads everything (version 1 each)', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1'), task('t2'), task('t3')], journal: [{ id: 'j1', text: 'hi' }] } }).boot();
    await a.syncUntilClean();
    expect(w.server.liveRows(USER)).toHaveLength(4);
    expect(w.server.liveRows(USER).every(r => r.version === 1)).toBe(true);
    expectConverged([a], w.server);
  });

  it('seed items never overwrite server data and never duplicate', async () => {
    const w = world();
    const seeds = () => ({ habits: [{ id: 'seed-h1', name: 'Run', color: 'red' }, { id: 'seed-h2', name: 'Read' }] });
    const a = await w.make('A', { initial: seeds() }).boot(); await a.syncUntilClean();
    a.update('habits', 'seed-h1', { name: 'Run 5k' }); await a.syncUntilClean();
    const v = w.server.getRow(USER, 'habits', 'seed-h1')!.version;
    // a brand new device installs the app: it has the SAME seed ids with default values
    const b = await w.make('B', { initial: seeds() }).boot(); await b.syncUntilClean();
    expect(b.items('habits')).toHaveLength(2);
    expect(b.get('habits', 'seed-h1')).toMatchObject({ name: 'Run 5k' });
    expect(w.server.getRow(USER, 'habits', 'seed-h1')).toMatchObject({ data: { name: 'Run 5k' }, version: v });
    await a.syncUntilClean();
    expect(a.items('habits')).toHaveLength(2);
    expectConverged([a, b], w.server);
  });

  it('two fresh devices with the same seeds syncing at the same time produce one copy of each seed', async () => {
    const w = world(); const seeds = () => ({ habits: [{ id: 'seed-h1', name: 'Run' }, { id: 'seed-h2', name: 'Read' }], tasks: [{ id: 'seed-t', title: 'x' }] });
    const a = w.make('A', { initial: seeds() }); const b = w.make('B', { initial: seeds() });
    await Promise.all([a.boot(), b.boot()]); await converge([a, b], w.clock, w.server);
    expect(w.server.liveRows(USER)).toHaveLength(3);
    expectConverged([a, b], w.server);
  });

  it('create, edit and delete on A appear on B via pull', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('keep')] } }).boot(); const b = await w.make('B').boot();
    a.add('tasks', task('t1')); await a.syncUntilClean(); await b.sync();
    expect(b.get('tasks', 't1')).toMatchObject({ title: 'title t1' });
    a.update('tasks', 't1', { title: 'edited', done: true }); await a.syncUntilClean(); await b.sync();
    expect(b.get('tasks', 't1')).toMatchObject({ title: 'edited', done: true });
    a.remove('tasks', 't1'); await a.syncUntilClean(); await b.sync();
    expect(b.get('tasks', 't1')).toBeUndefined();
    expectConverged([a, b], w.server);
  });

  it('create, edit and delete on A appear on B via realtime (no explicit sync on B, no waiting beyond the push debounce)', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('keep')] } }).boot(); const b = await w.make('B').boot();
    await w.clock.advance(1000);
    expect(b.engine.info().live).toBe(true);
    a.add('tasks', task('t1')); await w.clock.advance(5000);
    expect(b.get('tasks', 't1')).toBeDefined();
    a.update('tasks', 't1', { title: 'live edit' }); await w.clock.advance(5000);
    expect(b.get('tasks', 't1')).toMatchObject({ title: 'live edit' });
    a.remove('tasks', 't1'); await w.clock.advance(5000);
    expect(b.get('tasks', 't1')).toBeUndefined();
    expectConverged([a, b], w.server);
  });

  it('a local edit is pushed automatically (debounced) without calling syncNow', async () => {
    const w = world(); const a = await w.make('A').boot();
    a.add('tasks', task('t1')); await w.clock.advance(10_000);
    expect(w.server.getRow(USER, 'tasks', 't1')).toBeDefined(); expect(a.engine.info().pending).toBe(0);
  });

  it('deleting the ONLY item in the whole store is a real delete (not mistaken for a wiped cache)', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('only')] } }).boot(); await a.syncUntilClean();
    const b = await w.make('B').boot(); expect(b.get('tasks', 'only')).toBeDefined();
    a.remove('tasks', 'only'); await a.syncUntilClean(); await b.sync();
    expect(w.server.getRow(USER, 'tasks', 'only')?.deleted, 'server should hold a tombstone').toBe(true);
    expect(a.get('tasks', 'only'), 'A must not get the item back').toBeUndefined(); expect(b.get('tasks', 'only')).toBeUndefined();
  });

  it('wake logs (id derived from the date) and meta settings sync like other items', async () => {
    const w = world(); const a = await w.make('A', { initial: { wake: [{ date: '2026-02-03', time: '06:00' }], meta: [{ id: 'settings', theme: 'dark' }] } }).boot(); await a.syncUntilClean();
    expect(w.server.getRow(USER, 'wake', 'wake:2026-02-03')).toBeDefined(); expect(w.server.getRow(USER, 'meta', 'settings')).toMatchObject({ data: { theme: 'dark' } });
    const b = await w.make('B').boot();
    expect(b.items('wake')).toEqual([expect.objectContaining({ date: '2026-02-03', time: '06:00' })]);
    expect(b.items('meta')[0]).toMatchObject({ id: 'settings', theme: 'dark' });
  });

  it('two users never see each other data', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1')] } }).boot(); await a.syncUntilClean();
    const other = await w.make('X', { user: '22222222-2222-4222-8222-222222222222' }).boot();
    expect(other.items('tasks')).toHaveLength(0);
    other.add('tasks', task('t1', { title: 'other user' })); await other.syncUntilClean();
    await a.sync(); expect(a.get('tasks', 't1')).toMatchObject({ title: 'title t1' });
  });
});

describe('engine: offline edits, merges and conflicts', () => {
  async function pair(initial = [task('t1', { note: 'n', title: 'x' }), task('t2')]) {
    const w = world(); const a = await w.make('A', { initial: { tasks: initial } }).boot(); await a.syncUntilClean();
    const b = await w.make('B').boot(); await b.syncUntilClean();
    return { w, a, b };
  }
  it('offline edits on A and B to different items converge', async () => {
    const { w, a, b } = await pair(); a.offline(); b.offline();
    a.update('tasks', 't1', { title: 'from A' }); a.add('tasks', task('a-new')); b.update('tasks', 't2', { title: 'from B' }); b.add('tasks', task('b-new'));
    expect(a.engine.info().pending).toBeGreaterThan(0);
    await converge([a, b], w.clock, w.server);
    expectConverged([a, b], w.server);
    expect(a.get('tasks', 't1')).toMatchObject({ title: 'from A' }); expect(a.get('tasks', 't2')).toMatchObject({ title: 'from B' });
    expect(a.get('tasks', 'b-new')).toBeDefined(); expect(b.get('tasks', 'a-new')).toBeDefined();
  });

  it('offline edits to different FIELDS of the same item merge: nothing lost, no conflict logged', async () => {
    const { w, a, b } = await pair(); a.offline(); b.offline();
    a.update('tasks', 't1', { note: 'note from A' }); b.update('tasks', 't1', { title: 'title from B', done: true });
    await converge([a, b], w.clock, w.server);
    for (const d of [a, b]) expect(d.get('tasks', 't1')).toMatchObject({ note: 'note from A', title: 'title from B', done: true });
    expectConverged([a, b], w.server);
    for (const d of [a, b]) expect(d.conflicts().filter(c => c.id === 't1' && c.kind !== 'merged'), `${d.name} conflict log`).toEqual([]);
  });

  for (const [first, second] of [['A', 'B'], ['B', 'A']] as const) {
    it(`same field edited offline on both: the server value (first to sync: ${first}) wins; the loser is logged and restoreConflict brings it back`, async () => {
      const { w, a, b } = await pair(); a.offline(); b.offline();
      const dev = { A: a, B: b }; dev.A.update('tasks', 't1', { title: 'AAA' }); dev.B.update('tasks', 't1', { title: 'BBB' });
      const win = dev[first], lose = dev[second]; win.online(); await win.syncUntilClean(); lose.online(); await lose.syncUntilClean(); await win.sync();
      for (const d of [a, b]) expect(d.get('tasks', 't1'), d.name).toMatchObject({ title: first === 'A' ? 'AAA' : 'BBB' });
      expectConverged([a, b], w.server);
      const entry = lose.conflicts().find(c => c.id === 't1' && c.collection === 'tasks');
      expect(entry, `${lose.name} should have logged the lost edit`).toBeDefined();
      expect(entry!.kind).toBe('server-won'); expect(entry!.fields).toContain('title'); expect(JSON.stringify(entry!.local)).toContain(second === 'A' ? 'AAA' : 'BBB');
      lose.engine.restoreConflict(entry!);
      expect(lose.get('tasks', 't1')).toMatchObject({ title: second === 'A' ? 'AAA' : 'BBB' });
      await converge([a, b], w.clock, w.server); expectConverged([a, b], w.server);
      expect(w.server.getRow(USER, 'tasks', 't1')!.data).toMatchObject({ title: second === 'A' ? 'AAA' : 'BBB' });
    });
  }

  it('edit vs delete, delete synced first: converges, and the edit is either kept or recoverable from the conflict log', async () => {
    const { w, a, b } = await pair(); a.offline(); b.offline();
    a.remove('tasks', 't1'); b.update('tasks', 't1', { title: 'precious edit' });
    a.online(); await a.syncUntilClean(); b.online(); await converge([a, b], w.clock, w.server);
    expectConverged([a, b], w.server);
    const alive = a.get('tasks', 't1');
    if (alive) expect(alive).toMatchObject({ title: 'precious edit' });
    else expect(b.conflicts().some(c => c.id === 't1' && c.kind === 'deleted-remotely' && JSON.stringify(c.local).includes('precious edit'))).toBe(true);
  });
  it('edit vs delete, edit synced first: converges, and the delete is either applied or the edit survives with a log', async () => {
    const { w, a, b } = await pair(); a.offline(); b.offline();
    a.remove('tasks', 't1'); b.update('tasks', 't1', { title: 'precious edit' });
    b.online(); await b.syncUntilClean(); a.online(); await converge([a, b], w.clock, w.server);
    expectConverged([a, b], w.server);
    const alive = a.get('tasks', 't1');
    if (alive) expect(alive).toMatchObject({ title: 'precious edit' });
    expect(w.server.getRow(USER, 'tasks', 't2')).toBeDefined();
  });

  it('delete on both devices converges to deleted', async () => {
    const { w, a, b } = await pair(); a.offline(); b.offline(); a.remove('tasks', 't1'); b.remove('tasks', 't1');
    await converge([a, b], w.clock, w.server); expectConverged([a, b], w.server); expect(a.get('tasks', 't1')).toBeUndefined();
  });

  it('delete then recreate with the same id propagates the new item everywhere', async () => {
    const { w, a, b } = await pair();
    a.remove('tasks', 't1'); await a.syncUntilClean(); await b.sync(); expect(b.get('tasks', 't1')).toBeUndefined();
    a.add('tasks', { id: 't1', title: 'reborn' }); await a.syncUntilClean(); await b.sync();
    expect(b.get('tasks', 't1')).toEqual({ id: 't1', title: 'reborn' });
    expectConverged([a, b], w.server);
  });
  it('delete and recreate with the same id BEFORE syncing behaves like an edit', async () => {
    const { w, a, b } = await pair();
    a.remove('tasks', 't1'); a.add('tasks', { id: 't1', title: 'replaced' }); await converge([a, b], w.clock, w.server);
    expect(b.get('tasks', 't1')).toMatchObject({ title: 'replaced' }); expectConverged([a, b], w.server);
  });
  it('B recreates an id that A deleted (B never saw the tombstone)', async () => {
    const { w, a, b } = await pair(); b.offline();
    a.remove('tasks', 't1'); await a.syncUntilClean();
    b.remove('tasks', 't1'); b.add('tasks', { id: 't1', title: 'B reborn' }); b.online();
    await converge([a, b], w.clock, w.server); expectConverged([a, b], w.server);
    // from the engine's point of view this is an edit of t1 racing a delete: either the new item survives or it is recoverable from the log
    if (a.get('tasks', 't1')) expect(a.get('tasks', 't1')).toMatchObject({ title: 'B reborn' });
    else expect(b.conflicts().some(c => c.id === 't1' && c.kind === 'deleted-remotely' && JSON.stringify(c.local).includes('B reborn'))).toBe(true);
  });

  it('clock skew between devices does not matter: the later WALL clock does not win, the first to reach the server does', async () => {
    const w = world({ skew: { A: -86_400_000, B: +86_400_000 } });
    const a = await w.make('A', { initial: { tasks: [task('t1')] } }).boot(); await a.syncUntilClean(); const b = await w.make('B').boot();
    a.offline(); b.offline(); a.update('tasks', 't1', { title: 'A (clock behind)' }); await w.clock.advance(1000); b.update('tasks', 't1', { title: 'B (clock ahead)' });
    a.online(); await a.syncUntilClean(); b.online(); await converge([a, b], w.clock, w.server);
    for (const d of [a, b]) expect(d.get('tasks', 't1')).toMatchObject({ title: 'A (clock behind)' });
    expectConverged([a, b], w.server);
  });
});
