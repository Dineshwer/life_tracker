import { describe, it, expect } from 'vitest';
import { oldWorld, applyMigrations, applyAllSql, UID, serverRows } from './world';
import { NewDevice, keyed } from './device';
import { createDb, createUser, migrationSql, MIGRATION_FILES } from '../db/harness';
import { createSupabaseRemote } from '../../../src/sync/remote';
import { createSyncEngine } from '../../../src/sync/engine';
import { MemStore, MemStorage } from '../engine/harness';
import { LISTS } from './fixtures';
import { canon } from '../../../src/sync/merge';

/* DEPLOY FIRST, SQL LATER: the new app is live while the table is still 0001. */
const snapshotLocal = (d: NewDevice) => Object.fromEntries([...LISTS, 'kv' as const].map((c) => [c, d.list(c).map((x: any) => canon(x)).sort()]));

describe('S7: new client running BEFORE the SQL is applied', () => {
  it('0001 table: nothing is lost or deleted, the legacy snapshot is kept, an error is surfaced, and the device recovers by itself once apply-all.sql has run', async () => {
    const w = await oldWorld(); const before = await serverRows(w.db, UID);
    const d = await NewDevice.open('laptop', w.laptop.localStorageDump(w.legacy), w.db, UID, w.clock); await d.boot();
    const local0 = snapshotLocal(d);
    expect(d.info().status).toBe('error'); console.log('ERROR TEXT (PGlite/Postgres wording):', d.info().error);
    expect(d.info().error).toBeTruthy();
    expect(await serverRows(w.db, UID)).toEqual(before);                         // nothing written, nothing deleted
    expect(d.ls.has(`ledger-sync-${UID}`), 'legacy snapshot must survive a failed first pull').toBe(true);
    expect(d.state.habits.length).toBe(14); expect(d.state.habitLogs.length).toBe(296);      // the app still shows all data
    // the user keeps working during the outage
    d.set({ tasks: [...d.state.tasks, { id: 'during-outage', title: 'added while sync was broken', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' }] });
    await d.sync(); await w.clock.advance(60_000); expect(d.info().status).toBe('error');
    expect(d.info().pending).toBeGreaterThan(0);
    // the owner now pastes apply-all.sql
    await applyAllSql(w.db);
    // ... and does NOT touch the app: the engine's own retry timer picks it up (backoff is capped at 5 minutes)
    await w.clock.advance(6 * 60_000);
    expect(d.info().status, d.info().error).toBe('synced'); expect(d.info().pending).toBe(0);
    const rows = keyed(await serverRows(w.db, UID));
    expect(rows.get('tasks/during-outage')!.deleted).toBe(false);
    for (const r of before) expect(rows.get(`${r.collection}/${r.id}`)!.deleted).toBe(r.deleted);          // nothing tombstoned
    for (const [k, r] of keyed(before)) if (!k.startsWith('meta/')) expect(rows.get(k)!.data).toEqual(r.data);
    expect([...rows.keys()].filter((k) => k.startsWith('kv/')).length).toBe(6);                            // legacy gym keys arrived
    expect(d.ls.has(`ledger-sync-${UID}`)).toBe(false);                                                     // snapshot consumed after the first good pull
    expect(d.info().conflicts).toEqual([]);
    expect(Object.keys(snapshotLocal(d)).length).toBeGreaterThan(0); void local0;
  });

  it('0002 applied but 0003 (push_records) missing (a half-run): reads work, writes fail with a clear-ish error, nothing lost, recovers after 0003', async () => {
    const w = await oldWorld();
    for (const f of MIGRATION_FILES.slice(1, 2)) await w.db.exec(migrationSql(f));        // only 0002
    const before = await serverRows(w.db, UID);
    const d = await NewDevice.open('laptop', w.laptop.localStorageDump(w.legacy), w.db, UID, w.clock); await d.boot();
    expect(d.info().status).toBe('error'); console.log('ERROR TEXT (push_records missing):', d.info().error);
    expect(d.info().error).toMatch(/push_records/);
    expect((await serverRows(w.db, UID)).length).toBe(before.length);
    expect(d.state.habitLogs.length).toBe(296); expect(d.info().pending).toBeGreaterThan(0);
    await applyAllSql(w.db); await w.clock.advance(6 * 60_000);
    expect(d.info().status, d.info().error).toBe('synced'); expect(d.info().pending).toBe(0);
    expect([...keyed(await serverRows(w.db, UID)).keys()].filter((k) => k.startsWith('kv/')).length).toBe(6);
  });

  it('an EMPTY-cache device before the SQL: shows seed data + error, user input is kept, and after the SQL it merges with the old server data without loss or duplicates', async () => {
    const w = await oldWorld(); const before = await serverRows(w.db, UID);
    const phone = await NewDevice.open('phone', new Map(), w.db, UID, w.clock); await phone.boot();
    expect(phone.info().status).toBe('error');
    phone.set({ habitLogs: [...phone.state.habitLogs, { id: 'phone-log', habitId: 'meditate', date: '2026-11-18', level: 'full' }] });
    await applyAllSql(w.db); await w.clock.advance(6 * 60_000);
    expect(phone.info().status, phone.info().error).toBe('synced');
    const rows = keyed(await serverRows(w.db, UID));
    for (const r of before) expect(rows.get(`${r.collection}/${r.id}`)!.deleted, `${r.collection}/${r.id}`).toBe(r.deleted);
    expect(rows.get('habitLogs/phone-log')!.deleted).toBe(false);
    expect(phone.list('habitLogs').length).toBe(297); expect(phone.list('rejections').length).toBe(136);
    expect(new Set(phone.list('habits').map((h: any) => h.id)).size).toBe(phone.list('habits').length); expect(phone.list('habits').length).toBe(14);
  });

  it('FIXED DEFECT-D: the message a user would read: real PostgREST errors for a missing column / function', async () => {
    const mk = (pull: unknown, rpc: unknown) => {
      const chain: any = { select: () => chain, gt: () => chain, order: () => chain, limit: async () => pull };
      return { from: () => chain, rpc: async (name: string) => (name === 'pull_changes' ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pull_changes in the schema cache', status: 404 } } : rpc), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {}, auth: { getSession: async () => ({ data: { session: null } }) } } as any;
    };
    const cases: [string, any, any][] = [
      ['missing seq column', { data: null, error: { code: '42703', message: 'column records.seq does not exist', status: 400 } }, { data: [], error: null }],
      ['missing push_records', { data: [], error: null }, { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.push_records(p_device_id, p_items) in the schema cache', status: 404 } }],
    ];
    const out: Record<string, string | undefined> = {};
    for (const [name, pull, rpc] of cases) {
      const store = new MemStore({ tasks: [{ id: 't1', title: 'x' }] });
      const e = createSyncEngine({ remote: createSupabaseRemote(mk(pull, rpc), UID), store, storage: new MemStorage(), userId: UID, deviceId: 'x', setTimeout: () => 0, clearTimeout: () => {} });
      e.start(); await e.syncNow().catch(() => {}); out[name] = e.info().error; e.stop();
    }
    console.log('USER-VISIBLE ERRORS', out);
    for (const v of Object.values(out)) expect(v, 'must tell the owner the database upgrade has not been applied').toMatch(/not (been )?(applied|upgraded)|apply-all|database upgrade|supabase/i);
  });
});
