import { describe, it, expect } from 'vitest';
import { oldWorld, applyAllSql, asAdmin, UID, serverRows } from './world';
import { NewDevice, keyed } from './device';
import { OldClient, pgOldDb } from './oldClient';
import { legacyKeys, clone } from './fixtures';
import { asUser, item } from '../db/harness';

/* ROLLBACK: the SQL upgrade is done and the new client has been used (kv rows, tombstones, version > 1), then the owner reverts the app to the OLD bundle. */
async function upgradedThenUsed() {
  const w = await oldWorld(); await applyAllSql(w.db);
  const lap = await NewDevice.open('laptop', w.laptop.localStorageDump(w.legacy), w.db, UID, w.clock); await lap.boot(); await lap.sync();
  const victim = lap.list('tasks')[3].id;
  lap.set({ tasks: [...lap.list('tasks').filter((t: any) => t.id !== victim), { id: 'new-client-task', title: 'written by the new client', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' }], settings: { ...lap.state.settings, theme: 'light' } });
  await lap.sync(); await lap.sync();
  // the device now runs the OLD bundle again: its persisted store (version 3 blob, extra `kv` field) + the browser has NO ledger-* keys any more
  const persisted = JSON.parse(lap.ls.get('life-tracker-v1')!);
  return { w, lap, victim, persisted };
}
const rollbackSql = `
  grant insert, update, delete on public.records to authenticated;
  drop policy if exists "own rows" on public.records;
  create policy "own rows" on public.records for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

describe('S8: rollback to the OLD client after the SQL upgrade', () => {
  it('the old client can still READ the upgraded table (columns added, select-only policy) but every WRITE is refused: it becomes read-only with an error banner', async () => {
    const { w, victim } = await upgradedThenUsed();
    // an old device with a cache from before the upgrade
    const old = new OldClient(UID, pgOldDb(w.db, UID), clone(w.laptop.state), JSON.parse(w.laptop.snapshotBlob()));
    old.state.tasks.push({ id: 'old-edit', title: 'typed in the reverted app', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' });
    await old.cycle();
    expect(old.status).toBe('error'); expect(old.lastError).toMatch(/permission denied for table records/);
    expect(old.pending()).toBe(1);                                                                       // kept locally, banner says 1 unsynced
    // reading works: the new client's task appears, the item it deleted (tombstone) disappears, settings (with extra id/settledThrough) are adopted
    expect(old.state.tasks.map((t: any) => t.id)).toContain('new-client-task'); expect(old.state.tasks.map((t: any) => t.id)).not.toContain(victim);
    expect(old.state.settings.theme).toBe('light');
    // a brand-new old-client install (empty cache) can also read everything
    const fresh = new OldClient(UID, pgOldDb(w.db, UID), { ...clone(w.laptop.state), habits: [], habitLogs: [], tasks: [], xp: [], journal: [], rejections: [] } as any);
    await fresh.cycle(); expect(fresh.state.habitLogs.length).toBe(296); expect(fresh.state.rejections.length).toBe(136);
    expect((await serverRows(w.db, UID)).some((r) => r.id === 'old-edit')).toBe(false);
  });

  it('the gym/cardio/mobility/preferences the new client migrated into kv are INVISIBLE to the reverted app (browser originals were deleted); the data is intact in kv and restorable', async () => {
    const { w, lap, persisted } = await upgradedThenUsed();
    for (const k of Object.keys(w.legacy)) expect(lap.ls.has(k), `old client would look for localStorage[${k}]`).toBe(false);
    expect(persisted.version).toBe(3);                                      // the old store (version 2 code) will see a NEWER persisted version
    const kv = (await serverRows(w.db, UID)).filter((r) => r.collection === 'kv' && !r.deleted);
    expect(Object.fromEntries(kv.map((r) => [r.id, r.data.value]))).toEqual(w.legacy);   // lossless: byte-identical values are on the server
    // the manual restore the owner can run in the browser console of each device (documented in the report): rebuild the keys from kv
    const restored = new Map<string, string>(); for (const r of kv) restored.set(r.id, r.data.value);
    expect(Object.fromEntries(restored)).toEqual(w.legacy);
  });

  it('rollback SQL (grant + "own rows" policy) makes the old client fully writable again; the trigger still owns version/seq/updated_at; the new client picks the old client\'s writes up', async () => {
    const { w, lap } = await upgradedThenUsed();
    await asAdmin(w.db).exec(rollbackSql);
    const old = new OldClient(UID, pgOldDb(w.db, UID), clone(w.laptop.state), JSON.parse(w.laptop.snapshotBlob()));
    old.state.tasks.push({ id: 'old-edit', title: 'typed in the reverted app', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' });
    const habitId = old.state.habits[5].id; old.state.habits[5].name = 'renamed by old client';
    const seqBefore = Math.max(...(await serverRows(w.db, UID)).map((r) => r.seq));
    await old.cycle(); expect(old.status, old.lastError).toBe('synced'); expect(old.pending()).toBe(0);
    const rows = keyed(await serverRows(w.db, UID));
    expect(rows.get('tasks/old-edit')).toMatchObject({ version: 1, deleted: false }); expect(rows.get('tasks/old-edit')!.seq).toBeGreaterThan(seqBefore);   // trigger assigned seq
    expect(rows.get(`habits/${habitId}`)!.version).toBe(2);                                                                                                   // trigger bumped version on the old UPSERT
    // old client's own resurrect-on-delete bug aside, the constraints still apply to it
    await expect(pgOldDb(w.db, UID).upsert([{ user_id: UID, collection: 'nope', id: 'x', data: {}, deleted: false, updated_at: new Date().toISOString() }])).rejects.toThrow(/records_collection_ok/);
    // roll forward again: the new client sees the old client's work through its normal seq cursor, nothing duplicated
    await lap.sync(); await lap.sync();
    expect(lap.byId('tasks').has('old-edit')).toBe(true); expect(lap.byId('habits').get(habitId)!.name).toBe('renamed by old client');
    expect(lap.info().pending).toBe(0); expect(lap.info().conflicts).toEqual([]);
    expect(lap.list('tasks').length).toBe(lap.byId('tasks').size);
    // and the new write path keeps working after the policy/grant were widened
    const res = await asUser(w.db, UID).push([item('tasks', 'old-edit', { id: 'old-edit', title: 'x', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' }, 1)]); expect(res[0].status).toBe('ok');
  });

  it('what rolling back does NOT undo: tombstones and rows added by the new client stay (old client honours tombstones), version/seq/created_at/device_id columns stay (ignored by the old client)', async () => {
    const { w, victim } = await upgradedThenUsed();
    const rows = keyed(await serverRows(w.db, UID));
    expect(rows.get(`tasks/${victim}`)!.deleted).toBe(true);
    const cols = (await asAdmin(w.db).query<any>(`select column_name from information_schema.columns where table_name='records' and table_schema='public' order by 1`)).map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['version', 'seq', 'created_at', 'device_id']));
  });
});
