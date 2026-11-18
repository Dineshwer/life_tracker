import { describe, it, expect } from 'vitest';
import { oldWorld, applyMigrations, applyAllSql, asAdmin, UID, serverRows } from './world';
import { keyed } from './device';
import { createDb, createUser, asUser, item } from '../db/harness';
import { COLLECTIONS } from '../../../src/sync/types';

async function constraintReport(db: any) {
  return asAdmin(db).query<any>(`select conname, convalidated from pg_constraint where conrelid = 'public.records'::regclass and contype = 'c' order by 1`);
}

describe('S1: the 0001 table written by the old client, upgraded in place', () => {
  it('the old client really writes what we think (counts, ids, meta/settings without id, wake ids, tombstones)', async () => {
    const w = await oldWorld();
    const rows = w.rowsBeforeUpgrade; const by = (c: string) => rows.filter((r) => r.collection === c);
    expect(by('habits')).toHaveLength(14); expect(by('habitLogs').filter((r) => !r.deleted)).toHaveLength(296); expect(by('xp')).toHaveLength(210);
    expect(by('rejections').filter((r) => !r.deleted)).toHaveLength(136); expect(by('wake')).toHaveLength(40); expect(by('meta')).toHaveLength(1);
    expect(by('wake')[0].id).toMatch(/^wake:\d{4}-\d{2}-\d{2}$/);
    expect(by('meta')[0]).toMatchObject({ id: 'settings', data: { theme: 'dark', wakeTime: '06:30' } });
    expect(Object.keys(by('meta')[0].data)).not.toContain('id');
    expect(by('kv')).toHaveLength(0);
    const tomb = rows.filter((r) => r.deleted); expect(tomb.length).toBe(5 + 4 + 1); expect(tomb.every((r) => JSON.stringify(r.data) === '{}')).toBe(true);
  });

  it('DEFECT (old client, pre-existing): a delete made on the old client is resurrected by its own next cycle, so the old table normally holds no tombstones', async () => {
    const w = await oldWorld(); const victim = w.laptop.state.tasks[0].id;
    w.laptop.state.tasks = w.laptop.state.tasks.slice(1);          // user deletes a task
    expect(w.laptop.pending()).toBe(1);
    await w.laptop.cycle();                                         // fetchAll sees the live row, "unmodified" (cur missing) -> re-added, push has nothing to do
    expect(w.laptop.state.tasks.map((t: any) => t.id)).toContain(victim);
    expect(w.laptop.pending()).toBe(0);
  });

  it('0002-0004 in place: every row survives byte-for-byte, tombstones kept, sane version/seq, all constraints VALID, nothing rejected', async () => {
    const w = await oldWorld(); const before = keyed(w.rowsBeforeUpgrade);
    const oldTimes = await asAdmin(w.db).query<any>('select collection, id, updated_at from public.records order by updated_at, collection, id');
    await applyMigrations(w.db);
    const after = await serverRows(w.db, UID); const a = keyed(after);
    expect(after.length).toBe(w.rowsBeforeUpgrade.length);
    for (const [k, r] of before) { const x = a.get(k)!; expect(x, k).toBeTruthy(); expect(x.data, k).toEqual(r.data); expect(x.deleted, k).toBe(r.deleted); expect(x.version, k).toBe(1); }
    expect(new Set(after.map((r) => r.seq)).size).toBe(after.length);      // unique
    expect(Math.min(...after.map((r) => r.seq))).toBeGreaterThanOrEqual(1);
    // seq follows the old updated_at order (the old client wrote in 2 batches: initial upload, then tombstones/deletes)
    const ordered = [...after].sort((x, y) => x.seq - y.seq).map((r) => `${r.collection}/${r.id}`);
    expect(ordered.slice(-10).every((k) => before.get(k)!.deleted)).toBe(true);
    const meta = await asAdmin(w.db).query<any>('select count(*)::int as n, count(created_at)::int as c, count(device_id)::int as d from public.records');
    expect(meta[0]).toMatchObject({ n: after.length, c: after.length, d: 0 });
    // updated_at untouched by the migration
    const newTimes = await asAdmin(w.db).query<any>('select collection, id, updated_at from public.records order by updated_at, collection, id');
    expect(newTimes.map((r) => String(r.updated_at))).toEqual(oldTimes.map((r) => String(r.updated_at)));
    const cons = await constraintReport(w.db);
    expect(cons.filter((c: any) => !c.convalidated), 'constraints left NOT VALID by legacy rows').toEqual([]);
    expect(cons.map((c: any) => c.conname)).toEqual(expect.arrayContaining(['records_collection_ok', 'records_data_object', 'records_data_size', 'records_id_len_ok', 'records_tombstone_small', 'records_version_pos']));
    // the table is usable through the new write path and closed to direct writes
    const s = asUser(w.db, UID);
    const [ok] = await s.push([item('kv', 'ledger-gym-plan', { id: 'ledger-gym-plan', value: '{}' })]); expect(ok.status).toBe('ok');
    expect(ok.row.seq).toBeGreaterThan(Math.max(...after.map((r) => r.seq)));       // the sequence continued after the backfill
    await expect(s.query(`insert into public.records (collection, id, data) values ('habits','zz','{}')`)).rejects.toThrow(/permission denied/);
  });

  it('apply-all.sql twice on the same 0001 table gives the same result as 0002-0004 one by one', async () => {
    const w1 = await oldWorld(); const w2 = await oldWorld();
    await applyMigrations(w1.db); await applyAllSql(w2.db); await applyAllSql(w2.db);
    const r1 = await serverRows(w1.db, UID), r2 = await serverRows(w2.db, UID);
    const norm = (r: any[]) => r.map((x) => ({ k: `${x.collection}/${x.id}`, d: x.data, del: x.deleted, v: x.version }));
    expect(norm(r2)).toEqual(norm(r1));
    // second run did not bump versions or seqs
    const seqBefore = Math.max(...r2.map((r) => r.seq)); await applyAllSql(w2.db);
    const r3 = await serverRows(w2.db, UID); expect(r3).toEqual(r2); expect(Math.max(...r3.map((r) => r.seq))).toBe(seqBefore);
    expect((await constraintReport(w2.db)).filter((c: any) => !c.convalidated)).toEqual([]);
    // nightly backup function exists and works on upgraded data
    const bk = await asUser(w2.db, UID).rpc('take_backup'); expect(bk.row_count).toBe(r2.filter((r) => !r.deleted).length);
  });

  it('a second user on the same table is unaffected and isolated after the upgrade', async () => {
    const w = await oldWorld(); const B = '33333333-3333-4333-8333-333333333333'; await createUser(w.db, B);
    await asUser(w.db, B).query(`insert into public.records (user_id, collection, id, data) values ($1,'habits','hb','{"id":"hb"}')`, [B]);
    await applyAllSql(w.db);
    expect((await serverRows(w.db, B)).map((r) => r.id)).toEqual(['hb']);
    expect(await asUser(w.db, B).query('select 1 from public.records where user_id = $1', [UID])).toEqual([]);
  });

  it('FINDING probe: legacy rows that violate the new constraints are reported (NOT VALID) instead of failing; list them', async () => {
    const w = await oldWorld();
    const a = asAdmin(w.db);
    // what could really exist in an old table: a >512 KB row (progress photo data URL is capped at 400k chars by the new validator, but old client had no cap),
    // a fat tombstone from an old build, a non-object data value (never written by the old client: documented as impossible), id > 200 chars
    await a.query(`insert into public.records (user_id, collection, id, data) values ($1,'body','fat',jsonb_build_object('id','fat','date','2026-01-01','photo',repeat('x',600000)))`, [UID]);
    await a.query(`insert into public.records (user_id, collection, id, data, deleted) values ($1,'tasks','fat-tomb',jsonb_build_object('junk',repeat('y',3000)),true)`, [UID]);
    await a.query(`insert into public.records (user_id, collection, id, data) values ($1,'xp',repeat('i',250),'{}')`, [UID]);
    await applyAllSql(w.db);
    const cons = await constraintReport(w.db); const bad = cons.filter((c: any) => !c.convalidated).map((c: any) => c.conname).sort();
    console.log('NOT VALID after upgrade with hostile legacy rows:', bad);
    expect(bad).toEqual(['records_data_size', 'records_id_len_ok']);                     // fat tombstone was shrunk by 0002 section 3, so tombstone_small validated
    const fat = (await serverRows(w.db, UID)).find((r) => r.id === 'fat-tomb')!; expect(fat.data).toEqual({});
    // the oversize live row is still there (not deleted by the migration) and readable by the client
    const photo = (await serverRows(w.db, UID)).find((r) => r.id === 'fat')!; expect(JSON.stringify(photo.data).length).toBeGreaterThan(600000);
    // and the client cannot write it back (rejected) but can still write others
    const res = await asUser(w.db, UID).push([item('body', 'fat', { id: 'fat', date: '2026-01-01', photo: 'x'.repeat(600000) }, 1)]); expect(res[0].status).toBe('rejected');
  });
});
