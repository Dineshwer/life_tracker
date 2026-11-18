import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, createUser, asUser, asAdmin, applyAllSql, applyMigrations, item, MIGRATION_FILES, migrationSql, SUPABASE_DIR } from './harness';

let db: PGlite;
let A: string, B: string;
beforeEach(async () => {
  db = await createDb();
  A = await createUser(db);
  B = await createUser(db);
});

const rows = (uid: string, where = 'true') => asUser(db, uid).query<any>(`select * from records where ${where} order by seq`);
const noWrite = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(/permission denied|row-level security/i); };

describe('upgrade of a 0001-shaped table', () => {
  it('backfills version/seq in updated_at order and keeps every row', async () => {
    const d = await createDb({ upTo: '0001' });
    const u = await createUser(d);
    await d.query(`insert into records (user_id, collection, id, data, updated_at) values
      ($1,'habits','b','{"x":2}','2024-02-01'), ($1,'habits','a','{"x":1}','2024-01-01'), ($1,'tasks','c','{"x":3}','2024-03-01')`, [u]);
    await d.query(`insert into records (user_id, collection, id, data, deleted, updated_at) values ($1,'tasks','fat','{"big":"${'x'.repeat(5000)}"}',true,'2024-04-01')`, [u]);
    await applyMigrations(d);
    const r = (await d.query<any>('select * from records order by seq')).rows;
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c', 'fat']);
    expect(r.every((x) => Number(x.version) === 1)).toBe(true);
    expect(r.map((x) => Number(x.seq))).toEqual([1, 2, 3, 4]);
    expect(new Date(r[0].created_at).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(r[3].data).toEqual({});               // fat tombstone shrunk
    // new writes continue after the highest seq
    const res = await asUser(d, u).push([item('habits', 'n')]);
    expect(res[0].row.seq).toBe(5);
  });
  it('does not fail when a legacy row violates a constraint; new writes are still checked', async () => {
    const d = await createDb({ upTo: '0001' });
    const u = await createUser(d);
    await d.query(`insert into records (user_id, collection, id) values ($1,'legacy-unknown','x')`, [u]);
    await applyMigrations(d);
    expect((await d.query('select 1 from records')).rows.length).toBe(1);
    const nv = (await d.query<any>(`select convalidated from pg_constraint where conname='records_collection_ok'`)).rows[0];
    expect(nv.convalidated).toBe(false);
    await expect(d.query(`insert into records (user_id, collection, id) values ($1,'nope','y')`, [u])).rejects.toThrow(/records_collection_ok/);
  });
});

describe('idempotency', () => {
  it('apply-all.sql twice, then migrations again, keeps data and works', async () => {
    await asUser(db, A).push([item('habits', 'h1')]);
    await applyAllSql(db);
    await applyAllSql(db);
    await applyMigrations(db);
    const r = await rows(A);
    expect(r.length).toBe(1);
    expect(Number(r[0].version)).toBe(1);
    expect((await asUser(db, A).push([item('habits', 'h1', { v: 2 }, 1)]))[0].status).toBe('ok');
  });
  it('apply-all.sql on a fresh 0001 database equals running the migrations', async () => {
    const d = await createDb({ upTo: '0001' });
    await applyAllSql(d);
    const u = await createUser(d);
    expect((await asUser(d, u).push([item('kv', 'k')]))[0].status).toBe('ok');
  });
  it('apply-all.sql and schema.sql contain every migration verbatim', () => {
    for (const f of ['apply-all.sql', 'schema.sql']) {
      const all = readFileSync(join(SUPABASE_DIR, f), 'utf8');
      for (const m of MIGRATION_FILES) expect(all).toContain(migrationSql(m));
    }
  });
  it('records is in the realtime publication', async () => {
    const r = await asAdmin(db).query(`select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='records'`);
    expect(r.length).toBe(1);
  });
});

describe('push_records semantics', () => {
  it('insert, update, conflict, gone', async () => {
    const s = asUser(db, A);
    const [c] = await s.push([item('habits', 'h', { n: 1 })], 'dev1');
    expect(c.status).toBe('ok');
    expect(c.row).toMatchObject({ collection: 'habits', id: 'h', version: 1, deleted: false, device_id: 'dev1', data: { n: 1 } });
    const [u] = await s.push([item('habits', 'h', { n: 2 }, 1)], 'dev2');
    expect(u.status).toBe('ok');
    expect(u.row).toMatchObject({ version: 2, data: { n: 2 }, device_id: 'dev2' });
    expect(u.row.seq).toBeGreaterThan(c.row.seq);
    const [stale] = await s.push([item('habits', 'h', { n: 3 }, 1)]);
    expect(stale.status).toBe('conflict');
    expect(stale.row).toMatchObject({ version: 2, data: { n: 2 } });
    const [zero] = await s.push([item('habits', 'h', { n: 4 }, 0)]);
    expect(zero.status).toBe('conflict');
    const [gone] = await s.push([item('habits', 'nothere', { n: 1 }, 5)]);
    expect(gone.status).toBe('gone');
    expect(gone.row).toBeUndefined();
    expect((await rows(A))[0].data).toEqual({ n: 2 });   // conflicts wrote nothing
  });
  it('returns results in input order, per item, mixing statuses', async () => {
    const s = asUser(db, A);
    await s.push([item('tasks', 't1')]);
    const res = await s.push([item('tasks', 't2'), item('tasks', 't1', {}, 0), item('bogus', 'x'), item('tasks', 'zz', {}, 3), item('tasks', 't1', { a: 1 }, 1)]);
    expect(res.map((r) => [r.id, r.status])).toEqual([['t2', 'ok'], ['t1', 'conflict'], ['x', 'rejected'], ['zz', 'gone'], ['t1', 'ok']]);
    expect(res[2].reason).toMatch(/collection/);
  });
  it('tombstones and resurrection; tombstone data is cleared', async () => {
    const s = asUser(db, A);
    await s.push([item('tasks', 't', { big: 'y'.repeat(2000) })]);
    const [d] = await s.push([item('tasks', 't', { big: 'y'.repeat(2000) }, 1, true)]);
    expect(d.row).toMatchObject({ deleted: true, version: 2, data: {} });
    const [r] = await s.push([item('tasks', 't', { back: 1 }, 2)]);
    expect(r.row).toMatchObject({ deleted: false, version: 3, data: { back: 1 } });
  });
  it('seq is strictly increasing across writes and users', async () => {
    const seqs: number[] = [];
    for (let i = 0; i < 3; i++) {
      seqs.push((await asUser(db, A).push([item('kv', 'a', { i }, i)]))[0].row.seq);
      seqs.push((await asUser(db, B).push([item('kv', 'a', { i }, i)]))[0].row.seq);
    }
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    const ordered = await rows(A, 'seq > 0');
    expect(ordered.map((r) => Number(r.seq))).toEqual([...ordered.map((r) => Number(r.seq))].sort((x, y) => x - y));
  });
  it('a batch gets increasing seqs in item order', async () => {
    const res = await asUser(db, A).push([item('kv', '1'), item('kv', '2'), item('kv', '3')]);
    const s = res.map((r) => r.row.seq);
    expect(s[0] < s[1] && s[1] < s[2]).toBe(true);
  });
  it('duplicate item in one batch: second sees the first (stale base => conflict)', async () => {
    const res = await asUser(db, A).push([item('kv', 'd', { a: 1 }), item('kv', 'd', { a: 2 })]);
    expect(res.map((r) => r.status)).toEqual(['ok', 'conflict']);
  });
  it('updated_at is server clock; seq/version/updated_at cannot be forged by data', async () => {
    const [r] = await asUser(db, A).push([{ ...item('kv', 'x'), version: 99, seq: 1, updated_at: '1999-01-01' }]);
    expect(r.row.version).toBe(1);
    expect(new Date(r.row.updated_at).getFullYear()).toBeGreaterThan(2020);
  });
  it('requires authentication', async () => {
    await expect(asUser(db, null).push([item('kv', 'x')])).rejects.toThrow(/permission denied|not authenticated/);
    await expect(asAdmin(db).push([item('kv', 'x')])).rejects.toThrow(/not authenticated/);
  });
});

describe('validation / rejection', () => {
  const rej = async (it: unknown, re: RegExp) => {
    const [r] = await asUser(db, A).push([it]);
    expect(r.status).toBe('rejected');
    expect(r.reason).toMatch(re);
    expect(r.row).toBeUndefined();
  };
  it('unknown collection', () => rej(item('nope', 'x'), /collection/));
  it('every contract collection is accepted', async () => {
    const cols = ['habits', 'habitLogs', 'tasks', 'blocks', 'workouts', 'body', 'journal', 'rewards', 'xp', 'books', 'conversations', 'rejections', 'videos', 'channels', 'oneLogs', 'kv', 'wake', 'meta'];
    const res = await asUser(db, A).push(cols.map((c) => item(c, 'i')));
    expect(res.every((r) => r.status === 'ok')).toBe(true);
  });
  it('bad ids', async () => {
    await rej(item('kv', ''), /id/);
    await rej(item('kv', 'x'.repeat(201)), /id/);
    await rej(item('kv', 'a\nb'), /id/);
    await rej({ collection: 'kv', data: {}, base_version: 0 }, /id/);
    expect((await asUser(db, A).push([item('kv', 'x'.repeat(200))]))[0].status).toBe('ok');
  });
  it('data must be an object', async () => {
    for (const d of [[1, 2], 'str', 5, null]) await rej(item('kv', 'x', d), /object/);
  });
  it('too large', async () => {
    await rej(item('kv', 'big', { s: 'x'.repeat(600000) }), /too large/);
    expect((await asUser(db, A).push([item('kv', 'ok', { s: 'x'.repeat(590000) })]))[0].status).toBe('ok');
  });
  it('bad base_version / deleted / item shape', async () => {
    await rej({ ...item('kv', 'x'), base_version: -1 }, /base_version/);
    await rej({ ...item('kv', 'x'), base_version: 1.5 }, /base_version/);
    await rej({ ...item('kv', 'x'), base_version: '0' }, /base_version/);
    await rej({ collection: 'kv', id: 'x', data: {} }, /base_version/);
    await rej({ ...item('kv', 'x'), deleted: 'yes' }, /deleted/);
    await rej('hello', /object/);
  });
  it('a rejected item does not abort or roll back its neighbours', async () => {
    const res = await asUser(db, A).push([item('kv', 'a'), item('zzz', 'b'), item('kv', 'c')]);
    expect(res.map((r) => r.status)).toEqual(['ok', 'rejected', 'ok']);
    expect((await rows(A)).map((r) => r.id)).toEqual(['a', 'c']);
  });
  it('batch limit: 500 ok, 501 errors and writes nothing', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => item('kv', `k${i}`));
    expect((await asUser(db, A).push(mk(500))).length).toBe(500);
    await expect(asUser(db, A).push(mk(501))).rejects.toThrow(/batch too large/);
    expect((await rows(A)).length).toBe(500);
    await expect(asUser(db, A).rpc('push_records', { p_items: { not: 'array' } })).rejects.toThrow(/array/);
    expect(await asUser(db, A).push([])).toEqual([]);
  });
  it('table constraints are a backstop for direct admin writes', async () => {
    const a = asAdmin(db);
    await expect(a.exec(`insert into records (user_id,collection,id,data) values ('${A}','nope','x','{}')`)).rejects.toThrow(/records_collection_ok/);
    await expect(a.exec(`insert into records (user_id,collection,id,data) values ('${A}','kv','x','[]')`)).rejects.toThrow(/records_data_object/);
    await expect(a.exec(`insert into records (user_id,collection,id,data) values ('${A}','kv','','{}')`)).rejects.toThrow(/records_id_len_ok/);
    await expect(a.exec(`insert into records (user_id,collection,id,data,deleted) values ('${A}','kv','t','{"a":"${'x'.repeat(2000)}"}',true)`)).rejects.toThrow(/records_tombstone_small/);
  });
});

describe('concurrency', () => {
  it('two pushes with the same base_version: exactly one wins', async () => {
    await asUser(db, A).push([item('kv', 'c', { v: 0 })]);
    const results = await Promise.all([
      asUser(db, A).push([item('kv', 'c', { who: 1 }, 1)], 'd1'),
      asUser(db, A).push([item('kv', 'c', { who: 2 }, 1)], 'd2'),
    ]);
    expect(results.map((r) => r[0].status).sort()).toEqual(['conflict', 'ok']);
    expect(Number((await rows(A))[0].version)).toBe(2);
  });
  it('writers are serialised by a per-user lock and rows are locked FOR UPDATE', async () => {
    const src = (await asAdmin(db).query<any>(`select prosrc from pg_proc where proname='push_records'`))[0].prosrc;
    expect(src).toMatch(/pg_advisory_xact_lock/);
    expect(src).toMatch(/for update/);
  });
  it('the advisory lock is held until the transaction ends (second tx sees the first one commit)', async () => {
    await asUser(db, A).push([item('kv', 'c')]);
    const out = await asUser(db, A).tx(async (q) => {
      const r1 = (await q<any>(`select push_records($1::jsonb) r`, [JSON.stringify([item('kv', 'c', { a: 1 }, 1)])]))[0].r;
      const r2 = (await q<any>(`select push_records($1::jsonb) r`, [JSON.stringify([item('kv', 'c', { a: 2 }, 1)])]))[0].r;
      return [r1[0].status, r2[0].status];
    });
    expect(out).toEqual(['ok', 'conflict']);
  });
});

describe('access control / RLS', () => {
  beforeEach(async () => {
    await asUser(db, A).push([item('kv', 'secret', { s: 1 })]);
    await asUser(db, A).rpc('take_backup');
  });
  it('B cannot see A rows or backups', async () => {
    expect(await rows(B)).toEqual([]);
    expect(await asUser(db, B).query('select * from record_backups')).toEqual([]);
    expect(await asUser(db, B).rpc('list_backups')).toBeDefined();
  });
  it('B pushing the same key creates its own row; A is untouched', async () => {
    const [r] = await asUser(db, B).push([item('kv', 'secret', { s: 2 })]);
    expect(r.status).toBe('ok');
    expect((await rows(A))[0].data).toEqual({ s: 1 });
    expect((await rows(B))[0].data).toEqual({ s: 2 });
  });
  it('B cannot restore A backup (no backup for B) and B restore does not touch A', async () => {
    await expect(asUser(db, B).rpc('restore_backup', { p_date: new Date().toISOString().slice(0, 10) })).rejects.toThrow(/no daily backup/);
    expect((await rows(A)).length).toBe(1);
  });
  it('clients have no direct write access to records or record_backups', async () => {
    const s = asUser(db, A);
    await noWrite(s.exec(`insert into records (user_id,collection,id,data) values ('${A}','kv','direct','{}')`));
    await noWrite(s.exec(`update records set data='{}'`));
    await noWrite(s.exec(`delete from records`));
    await noWrite(s.exec(`insert into record_backups (user_id,taken_on,payload,row_count) values ('${A}', current_date, '[]', 0)`));
    await noWrite(s.exec(`delete from record_backups`));
    await noWrite(asUser(db, null).query('select * from records'));
  });
  it('maintenance and internal functions are not callable by clients', async () => {
    for (const f of ['run_nightly_backup()', 'purge_tombstones()', `_snapshot_user('${A}','daily')`]) {
      await noWrite(asUser(db, A).query(`select public.${f}`));
    }
    await noWrite(asUser(db, null).rpc('take_backup'));
  });
  it('an admin UPDATE still bumps version and seq (versioning cannot be bypassed)', async () => {
    const before = (await rows(A))[0];
    await asAdmin(db).exec(`update records set data='{"s":9}'`);
    const after = (await rows(A))[0];
    expect(Number(after.version)).toBe(Number(before.version) + 1);
    expect(Number(after.seq)).toBeGreaterThan(Number(before.seq));
  });
  it('pull query returns only own rows past the cursor', async () => {
    await asUser(db, B).push([item('kv', 'b1')]);
    const first = (await rows(A))[0];
    await asUser(db, A).push([item('kv', 'a2')]);
    const rest = await rows(A, `seq > ${first.seq}`);
    expect(rest.map((r) => r.id)).toEqual(['a2']);
  });
});

describe('backups', () => {
  const today = () => new Date().toISOString().slice(0, 10);
  it('take / list / restore round trip with safety backup', async () => {
    const s = asUser(db, A);
    await s.push([item('kv', 'keep', { v: 1 }), item('kv', 'edit', { v: 1 }), item('kv', 'del', { v: 1 })]);
    const bk = await s.rpc('take_backup');
    expect(bk).toMatchObject({ taken_on: today(), row_count: 3 });
    // later: edit, delete, add
    await s.push([item('kv', 'edit', { v: 2 }, 1), item('kv', 'del', {}, 1, true), item('kv', 'new', { v: 1 })]);
    const list = await s.rpc('list_backups');
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ row_count: 3, kind: 'daily' });
    const before = await rows(A);
    const touched = await s.rpc('restore_backup', { p_date: today() });
    expect(touched).toBe(3);   // new -> tombstone, edit -> reverted, del -> resurrected; keep untouched
    const after = Object.fromEntries((await rows(A)).map((r) => [r.id, r]));
    expect(after.keep.version).toEqual(before.find((r) => r.id === 'keep').version);
    expect(after.edit).toMatchObject({ data: { v: 1 }, deleted: false });
    expect(Number(after.edit.version)).toBe(3);
    expect(after.del).toMatchObject({ data: { v: 1 }, deleted: false });
    expect(after.new).toMatchObject({ deleted: true, data: {} });
    expect(Number(after.new.version)).toBe(2);
    for (const k of ['edit', 'del', 'new']) expect(Number(after[k].seq)).toBeGreaterThan(Math.max(...before.map((r) => Number(r.seq))));
    // safety backup exists, holds the pre-restore live state, and is itself restorable
    const all = await s.rpc('list_backups', { p_include_safety: true });
    const safety = all.find((b: any) => b.kind === 'pre-restore');
    expect(safety.row_count).toBe(3);   // edit, keep, new were live (del was tombstoned)
    expect((await s.rpc('list_backups')).every((b: any) => b.kind === 'daily')).toBe(true);
    await s.rpc('restore_backup', { p_date: today(), p_kind: 'pre-restore' });
    const back = Object.fromEntries((await rows(A)).map((r) => [r.id, r]));
    expect(back.edit.data).toEqual({ v: 2 });
    expect(back.new.deleted).toBe(false);
    expect(back.del.deleted).toBe(true);
    // a pushed stale version now conflicts (devices converge via version)
    expect((await s.push([item('kv', 'edit', { v: 9 }, 1)]))[0].status).toBe('conflict');
  });
  it('restore of a missing backup errors and changes nothing', async () => {
    await asUser(db, A).push([item('kv', 'x')]);
    await expect(asUser(db, A).rpc('restore_backup', { p_date: '2020-01-01' })).rejects.toThrow(/no daily backup/);
    expect((await rows(A)).length).toBe(1);
  });
  it('snapshot holds live rows only (tombstones excluded)', async () => {
    const s = asUser(db, A);
    await s.push([item('kv', 'a'), item('kv', 'b')]);
    await s.push([item('kv', 'b', {}, 1, true)]);
    expect((await s.rpc('take_backup')).row_count).toBe(1);
  });
  it('take_backup is rate limited to once per 10 minutes and refreshes afterwards', async () => {
    const s = asUser(db, A);
    await s.push([item('kv', 'a')]);
    expect((await s.rpc('take_backup')).throttled).toBeUndefined();
    await s.push([item('kv', 'b')]);
    const second = await s.rpc('take_backup');
    expect(second).toMatchObject({ throttled: true, row_count: 1 });
    await asAdmin(db).exec(`update record_backups set created_at = now() - interval '11 minutes'`);
    const third = await s.rpc('take_backup');
    expect(third.throttled).toBeUndefined();
    expect(third.row_count).toBe(2);
    expect((await s.rpc('list_backups')).length).toBe(1);   // upserted, still one daily row
  });
  it('nightly job backs up every user and applies 14-day retention', async () => {
    await asUser(db, A).push([item('kv', 'a')]);
    await asUser(db, B).push([item('kv', 'b')]);
    const admin = asAdmin(db);
    await admin.exec(`insert into record_backups (user_id, taken_on, kind, payload, row_count) values
      ('${A}', current_date - 20, 'daily', '[]', 0), ('${A}', current_date - 13, 'daily', '[]', 0), ('${A}', current_date - 20, 'pre-restore', '[]', 0)`);
    expect(await admin.rpc('run_nightly_backup')).toBe(2);
    const left = await admin.query<any>(`select user_id, kind, (current_date - taken_on) as age from record_backups`);
    expect(left.every((b) => Number(b.age) <= 14)).toBe(true);
    expect(left.filter((b) => b.user_id === A).length).toBe(2);   // -13 and today
    expect(left.filter((b) => b.user_id === B).length).toBe(1);
    expect(await admin.rpc('run_nightly_backup')).toBe(2);        // idempotent
    expect((await admin.query(`select 1 from record_backups where kind='daily' and user_id='${B}'`)).length).toBe(1);
  });
  it('purge_tombstones removes only old tombstones that a later daily backup covers', async () => {
    const s = asUser(db, A), admin = asAdmin(db);
    await s.push([item('kv', 'live'), item('kv', 'oldgone'), item('kv', 'recent'), item('kv', 'unbacked')]);
    await s.push([item('kv', 'oldgone', {}, 1, true), item('kv', 'recent', {}, 1, true)]);
    await admin.rpc('run_nightly_backup');            // backup now covers the tombstones above
    await s.push([item('kv', 'unbacked', {}, 1, true)]);   // deleted after the backup
    const age = async (id: string) => {
      await admin.exec(`alter table records disable trigger records_before_write`);
      await admin.exec(`update records set updated_at = now() - interval '100 days' where id='${id}'`);
      await admin.exec(`alter table records enable trigger records_before_write`);
    };
    await age('oldgone'); await age('unbacked');
    await admin.exec(`update record_backups set created_at = now() - interval '200 days'`);
    expect(await admin.rpc('purge_tombstones')).toBe(0);   // backup older than every tombstone: nothing may go
    await admin.exec(`update record_backups set created_at = now()`);
    expect(await admin.rpc('purge_tombstones')).toBe(2);   // oldgone + unbacked (both older than 90d and covered by backup taken now)
    const ids = (await rows(A)).map((r) => r.id).sort();
    expect(ids).toEqual(['live', 'recent']);               // recent tombstone (<90d) kept
    // a device holding a purged item gets 'gone'
    expect((await s.push([item('kv', 'oldgone', {}, 2)]))[0].status).toBe('gone');
  });
});
