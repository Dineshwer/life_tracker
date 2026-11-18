import { describe, expect, it } from 'vitest';
import { USER, expectConverged, task, world } from './harness';

describe('engine: scale and pagination', () => {
  for (const n of [1000, 5000]) it(`${n} items upload from A and a fresh device B pulls all of them (paged), identical and without duplicates`, async () => {
    const w = world(); const items = Array.from({ length: n }, (_, i) => task(`t${i}`, { n: i }));
    const a = await w.make('A', { initial: { tasks: items } }).boot(); await a.syncUntilClean();
    expect(w.server.liveRows(USER)).toHaveLength(n);
    const pullsBefore = w.server.calls.pull;
    const b = await w.make('B').boot();
    expect(b.items('tasks')).toHaveLength(n);
    expect(w.server.calls.pull - pullsBefore, 'pull must be paged, not one call per item').toBeLessThan(Math.ceil(n / 1000) * 3 + 6);
    expectConverged([a, b], w.server);
  });

  it('more than 500 pending changes are pushed in batches of at most 500 (and all arrive)', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('seed')] } }).boot(); await a.syncUntilClean();
    a.addMany('tasks', Array.from({ length: 1300 }, (_, i) => task(`n${i}`)));
    expect(a.engine.info().pending).toBe(1300);
    const before = w.server.calls.push; await a.syncUntilClean();
    expect(w.server.calls.push - before).toBeGreaterThanOrEqual(3);
    expect(w.server.liveRows(USER)).toHaveLength(1301); expect(a.engine.info().pending).toBe(0);
  });

  it('a large edit burst (all 1000 items edited at once) merges with a concurrent edit on another device', async () => {
    const w = world(); const items = Array.from({ length: 1000 }, (_, i) => task(`t${i}`, { n: i }));
    const a = await w.make('A', { initial: { tasks: items } }).boot(); await a.syncUntilClean(); const b = await w.make('B').boot();
    a.offline(); b.offline();
    for (let i = 0; i < 1000; i += 2) a.update('tasks', `t${i}`, { title: 'A' });
    for (let i = 1; i < 1000; i += 2) b.update('tasks', `t${i}`, { title: 'B' });
    a.online(); b.online(); await a.syncUntilClean(); await b.syncUntilClean(); await a.syncUntilClean();
    expectConverged([a, b], w.server); expect(a.get('tasks', 't10')).toMatchObject({ title: 'A' }); expect(a.get('tasks', 't11')).toMatchObject({ title: 'B' });
  });
});
