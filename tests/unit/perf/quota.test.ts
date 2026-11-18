/* What a localStorage quota failure can do to the engine. The store blob (zustand persist) and the sync-meta blob are two separate keys:
   if the store write fails (quota) but a later, smaller meta write succeeds, a reload sees "meta says X was confirmed, store has no X". */
import { describe, expect, it } from 'vitest';
import { USER, task, world, MemStore } from '../engine/harness';
import { metaKey } from '../../../src/sync/meta';

describe('quota: store blob stale while sync meta is fresh', () => {
  it('reports what happens to an item that exists in meta+server but is missing from the (stale) persisted store', async () => {
    const w = world();
    const a = await w.make('A', { initial: { tasks: [task('keep')] } }).boot(); await a.syncUntilClean();
    a.add('tasks', task('new-while-quota-full')); await a.syncUntilClean();   // pushed + meta saved
    expect(w.server.liveRows(USER).map(r => r.id).sort()).toEqual(['keep', 'new-while-quota-full']);
    // reload: browser restores the STALE store blob (without 'new-while-quota-full') but the fresh meta
    const staleStore = new MemStore({ tasks: [task('keep')] });
    const b = w.make('A', { store: staleStore, storage: a.storage });
    expect(a.storage.getItem(metaKey(USER))).toContain('new-while-quota-full');
    await b.boot(); await b.syncUntilClean();
    const live = w.server.liveRows(USER).map(r => r.id).sort();
    console.log('after reload with stale store, server has:', live, ' local has:', b.items('tasks').map(t => t.id));
    // DOCUMENTED FINDING: if this prints only ['keep'], the engine treated the missing item as a local deletion (data loss).
    expect(live, 'item must survive a stale persisted store').toContain('new-while-quota-full');
  });
});
