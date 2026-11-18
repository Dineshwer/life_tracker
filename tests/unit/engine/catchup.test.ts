import { describe, it, expect } from 'vitest';
import { world, task, flushMicrotasks, expectConverged } from './harness';

describe('engine: catch-up after realtime gaps and outages', () => {
  it('reconnecting realtime triggers an immediate catch-up pull (no replay from the server)', async () => {
    const w = world(); const a = await w.make('A').boot(); const b = await w.make('B').boot(); await w.clock.advance(1000);
    expect(a.engine.info().live).toBe(true);
    w.server.dropRealtime(); await flushMicrotasks();
    b.add('tasks', task('while-down')); await b.syncUntilClean();
    w.server.restoreRealtime(); // rows written during the gap are NOT delivered; only the live transition tells A
    await w.clock.advance(1000);
    expect(a.get('tasks', 'while-down'), 'catch-up pull on reconnect, long before any poll').toBeDefined();
    expectConverged([a, b], w.server);
  });
  it('after an outage ends, a follow-up pull (2-3 s) picks up what other devices wrote meanwhile', async () => {
    const w = world(); const a = await w.make('A').boot(); const b = await w.make('B').boot(); await w.clock.advance(1000);
    w.server.autoDeliver = false; // realtime delivers nothing: only pulls can help
    a.offline(); b.offline();
    a.add('tasks', task('a1')); b.add('tasks', task('b1'));
    await w.clock.advance(5000); a.online(); await a.sync(); b.online(); await b.sync();
    await w.clock.advance(4000); // follow-up cycles
    expect(a.get('tasks', 'b1')).toBeDefined(); expect(b.get('tasks', 'a1')).toBeDefined();
    expectConverged([a, b], w.server);
  });
  it('the live safety-net poll is 60 s', async () => {
    const w = world(); const a = await w.make('A').boot(); await w.clock.advance(1000);
    w.server.autoDeliver = false; const b = await w.make('B').boot();
    b.add('tasks', task('quiet')); await b.syncUntilClean();
    await w.clock.advance(70_000); expect(a.get('tasks', 'quiet')).toBeDefined();
  });
});
