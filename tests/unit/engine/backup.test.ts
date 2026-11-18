import { describe, expect, it } from 'vitest';
import { USER, expectConverged, task, world } from './harness';

describe('engine: server-side backup restore converges every device', () => {
  it('after restoreBackup on the server, all devices (including one with unsynced edits) converge on the snapshot', async () => {
    const w = world(); const a = await w.make('A', { initial: { tasks: [task('t1', { title: 'orig' }), task('t2'), task('t3')] } }).boot(); await a.syncUntilClean();
    const b = await w.make('B').boot();
    const info = await a.remote.takeBackup(); expect(info.row_count).toBe(3);
    a.update('tasks', 't1', { title: 'bad edit' }); a.remove('tasks', 't2'); a.add('tasks', task('t4')); await a.syncUntilClean(); await b.sync();
    expect(b.get('tasks', 't1')).toMatchObject({ title: 'bad edit' });
    await w.clock.advance(11 * 60_000);
    const touched = await a.remote.restoreBackup(info.taken_on); expect(touched).toBeGreaterThanOrEqual(3);
    await a.syncUntilClean(); await b.syncUntilClean(); await a.syncUntilClean();
    for (const d of [a, b]) { expect(d.get('tasks', 't1')).toMatchObject({ title: 'orig' }); expect(d.get('tasks', 't2')).toBeDefined(); expect(d.get('tasks', 't4')).toBeUndefined(); }
    expectConverged([a, b], w.server); expect(w.server.liveRows(USER)).toHaveLength(3);
  });
});
