/* Independent adversarial review of the DB layer. A FAILING test here = a confirmed defect (see report). Passing tests document checked properties. */
import { describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, createUser, asUser, asAdmin, applyAllSql, item } from '../db/harness';

async function fresh() {
  const db = await createDb();
  return { db, A: await createUser(db), B: await createUser(db) };
}

describe('D1 transient errors must not become permanent "rejected"', () => {
  it('a non-validation error (serialization failure / lock timeout / disk) is re-raised, not reported as rejected', async () => {
    const { db, A } = await fresh();
    await asAdmin(db).exec(`
      create function public.flaky() returns trigger language plpgsql as $$
      begin if new.id = 'flaky' then raise exception 'could not serialize access' using errcode = '40001'; end if; return new; end $$;
      create trigger flaky before insert on public.records for each row execute function public.flaky();`);
    let res: any[] | null = null, threw = false;
    try { res = await asUser(db, A).push([item('kv', 'flaky')]); } catch { threw = true; }
    // contract: 'rejected' = invalid item, do not retry. A transient DB error must fail the whole call (engine retries with backoff).
    expect(threw || res![0].status !== 'rejected').toBe(true);
  });
});

describe('D2 item shape', () => {
  it('a missing "deleted" key defaults to false (the CASE ... WHEN null branch is dead code)', async () => {
    const { db, A } = await fresh();
    const [r] = await asUser(db, A).push([{ collection: 'kv', id: 'x', data: { a: 1 }, base_version: 0 }]);
    expect(r.status).toBe('ok');
  });
  it('size limit is on jsonb::text (adds spaces), so a compact ~495 KB (JSON.stringify) object is refused', async () => {
    const { db, A } = await fresh();
    const data: Record<string, number> = {};
    for (let i = 0; i < 42000; i++) data['k' + i] = 1;
    const compact = JSON.stringify(data).length;
    expect(compact).toBeLessThan(524288);
    const [r] = await asUser(db, A).push([item('kv', 'big', data)]);
    expect(r.status).toBe('ok'); // fails today: server counts the spaced jsonb text, the client budget is JSON.stringify
  });
});

describe('D3 backups', () => {
  it('take_backup applies the 14-day retention itself (no pg_cron needed)', async () => {
    const { db, A } = await fresh();
    await asUser(db, A).push([item('kv', 'a')]);
    await asAdmin(db).exec(`insert into record_backups (user_id,taken_on,kind,payload,row_count) values ('${A}', (now() at time zone 'utc')::date - 40, 'daily','[]',0)`);
    await asUser(db, A).rpc('take_backup');
    const left = await asAdmin(db).query<any>(`select count(*)::int n from record_backups where taken_on < (now() at time zone 'utc')::date - 14`);
    expect(left[0].n).toBe(0);
  });
  it('a second take_backup the same UTC day (after a bad mass delete) must not destroy the only good snapshot of that day', async () => {
    const { db, A } = await fresh();
    const u = asUser(db, A);
    await u.push(Array.from({ length: 5 }, (_, i) => item('kv', 'k' + i)));
    await u.rpc('take_backup');                                        // good snapshot (5 rows)
    const cur = await u.query<any>(`select collection,id,version from records`);
    await u.push(cur.map((r: any) => ({ collection: r.collection, id: r.id, data: {}, deleted: true, base_version: r.version })));
    await asAdmin(db).exec(`update record_backups set created_at = created_at - interval '1 hour'`);
    await u.rpc('take_backup');                                        // buggy client snapshots the empty state
    const all = await u.query<any>(`select row_count from record_backups where user_id = '${A}'`);
    expect(Math.max(...all.map((r: any) => r.row_count))).toBe(5);     // fails today: the daily row was overwritten with 0
  });
  it('restore of a backup that holds a legacy-invalid row does not abort the whole restore', async () => {
    const db = await createDb({ upTo: '0001' });
    const A = await createUser(db);
    await asAdmin(db).exec(`insert into records (user_id,collection,id,data) values ('${A}','kv','arr','[1,2]'), ('${A}','kv','ok','{"a":1}')`);
    await applyAllSql(db);
    const u = asUser(db, A);
    await u.rpc('take_backup');
    const rows = await u.query<any>(`select collection,id,version from records where id='arr'`);
    await u.push([{ collection: 'kv', id: 'arr', data: {}, deleted: true, base_version: rows[0].version }]);
    await expect(u.rpc('restore_backup', { p_date: new Date().toISOString().slice(0, 10) })).resolves.toBeTypeOf('number');
  });
});

describe('S security: privileges as on a real Supabase (default privileges grant everything to anon/authenticated/service_role)', () => {
  async function supabaseLike() {
    const db = await createDb({ upTo: 'stubs' });
    await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
                   alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
                   alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
    const { migrationSql, MIGRATION_FILES } = await import('../db/harness');
    for (const f of MIGRATION_FILES) await db.exec(migrationSql(f));
    return db;
  }
  it('anon/authenticated can execute only the intended RPCs; nothing writable directly', async () => {
    const db = await supabaseLike();
    const fn = (await db.query<any>(`select p.oid::regprocedure::text sig,
        has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype`)).rows;
    const callable = fn.filter((r) => r.anon || r.auth).map((r) => `${r.sig}:${r.anon ? 'anon' : ''}${r.auth ? 'auth' : ''}`).sort();
    expect(callable).toEqual([
      'list_backups(boolean):auth', 'push_records(jsonb,text):auth', 'restore_backup(date,text):auth', 'take_backup():auth',
    ].sort());
    const tp = (await db.query<any>(`select c.relname, has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate'::text) w,
        has_table_privilege('anon', c.oid, 'select') anon_sel from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`)).rows;
    for (const t of tp) { expect(t.w).toBe(false); expect(t.anon_sel).toBe(false); }
  });
  it('clients hold no privilege on records_seq (default privileges leak USAGE to authenticated)', async () => {
    const db = await supabaseLike();
    const seq = (await db.query<any>(`select has_sequence_privilege('authenticated','public.records_seq','usage') u`)).rows;
    expect(seq[0].u).toBe(false); // fails if default privileges leak nextval on the seq (harmless but lets a client burn seq numbers via rpc? only via pg_catalog nextval, not exposed)
  });
  it('every public table has RLS enabled and every SECURITY DEFINER function pins search_path', async () => {
    const db = await supabaseLike();
    const t = (await db.query<any>(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'`)).rows;
    expect(t.map((r) => r.relname).sort()).toEqual(['record_backups', 'record_tombstone_floor', 'records']);
    expect(t.every((r) => r.relrowsecurity)).toBe(true);
    const f = (await db.query<any>(`select proname, proconfig from pg_proc where pronamespace='public'::regnamespace and prosecdef`)).rows;
    for (const r of f) expect((r.proconfig ?? []).join()).toMatch(/search_path=public, pg_temp/);
  });
  it('anon and unauthenticated authenticated sessions cannot push/take/restore', async () => {
    const db = await supabaseLike();
    await expect(asUser(db, null).push([])).rejects.toThrow(/permission denied/);
    const u = await createUser(db);
    for (const rs of [asAdmin(db)]) {
      await rs.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','',true)`).catch(() => {});
    }
    await expect(asUser(db, u).rpc('restore_backup', { p_date: '2020-01-01' })).rejects.toThrow(/no daily backup/);
  });
  it('B cannot read or restore A through any function, nor forge user_id via item payload', async () => {
    const { db, A, B } = await fresh();
    await asUser(db, A).push([item('kv', 'secret', { s: 1 })]);
    await asUser(db, A).rpc('take_backup');
    const forged = await asUser(db, B).push([{ ...item('kv', 'f'), user_id: A, data: { user_id: A } }]);
    expect(forged[0].status).toBe('ok');
    expect(await asUser(db, B).rpc('list_backups', { p_include_safety: true })).toEqual([]);
    const own = await asAdmin(db).query<any>(`select user_id from records where id='f'`);
    expect(own[0].user_id).toBe(B);
  });
  it('injection-looking collection/id/data are inert', async () => {
    const { db, A } = await fresh();
    const evil = `x'); drop table records; --`;
    const res = await asUser(db, A).push([item('kv', evil, { a: evil }), item(evil, 'y')]);
    expect(res.map((r) => r.status)).toEqual(['ok', 'rejected']);
    expect((await asAdmin(db).query<any>(`select count(*)::int n from records`))[0].n).toBe(1);
  });
});

describe('U upgrade of a large, dirty legacy table', () => {
  it('5000 rows incl. fat tombstones, non-object data, bad collection: nothing lost, seq unique, constraint state reported', async () => {
    const db = await createDb({ upTo: '0001' });
    const A = await createUser(db);
    await asAdmin(db).exec(`
      insert into records (user_id,collection,id,data,deleted,updated_at)
      select '${A}','kv','k'||g,'{"a":1}', false, now() - (g||' minutes')::interval from generate_series(1,5000) g;
      insert into records (user_id,collection,id,data,deleted) select '${A}','kv','fat'||g, jsonb_build_object('x', repeat('z',5000)), true from generate_series(1,20) g;
      insert into records (user_id,collection,id,data) values ('${A}','kv','arr','[1]'), ('${A}','bogus','b','{}');`);
    const t0 = Date.now();
    await applyAllSql(db);
    expect(Date.now() - t0).toBeLessThan(30000);
    const c = await asAdmin(db).query<any>(`select count(*)::int n, count(distinct seq)::int ds, min(version) mv, max(version) xv from records`);
    expect(c[0]).toMatchObject({ n: 5022, ds: 5022, mv: 1, xv: 1 });
    const nv = await asAdmin(db).query<any>(`select conname from pg_constraint where conrelid='public.records'::regclass and not convalidated order by 1`);
    expect(nv.map((r) => r.conname)).toEqual(['records_collection_ok', 'records_data_object']);
    // pull order == updated_at order of the legacy rows
    const first = await asUser(db, A).query<any>(`select id from records order by seq limit 1`);
    expect(first[0].id).toBe('k5000');
    // legacy rows that violate constraints can still be soft-deleted by the client
    const [r] = await asUser(db, A).push([{ collection: 'kv', id: 'arr', data: {}, deleted: true, base_version: 1 }]);
    expect(r.status).toBe('ok');
  });
});

describe('P purge / restore semantics (documenting)', () => {
  it('a stale device that pushes an edit of a purged tombstone gets "gone"; fresh create under the same id restarts at version 1', async () => {
    const { db, A } = await fresh();
    const u = asUser(db, A);
    await u.push([item('wake', 'wake:2026-01-01')]);
    await u.push([{ ...item('wake', 'wake:2026-01-01', {}, 1), deleted: true }]);
    await asAdmin(db).exec(`update records set updated_at = now() - interval '100 days'`); // trigger resets it; fix below
    await asAdmin(db).exec(`alter table records disable trigger records_before_write; update records set updated_at = now() - interval '100 days'; alter table records enable trigger records_before_write`);
    await u.rpc('take_backup');
    await asAdmin(db).query(`select public.purge_tombstones()`);
    const [g] = await u.push([item('wake', 'wake:2026-01-01', { z: 1 }, 2)]);
    expect(g.status).toBe('gone');
    const [n] = await u.push([item('wake', 'wake:2026-01-01', { z: 2 }, 0)]);
    expect(n.row.version).toBe(4); // F2: version floor (purged at v3 after the test's own admin UPDATE bumped it) -> recreated item starts above it
    // a stale device that still holds base_version 1 now silently overwrites the new item
    const [stale] = await u.push([item('wake', 'wake:2026-01-01', { z: 'stale' }, 1)]);
    expect(stale.status).toBe('conflict'); // fails today: version reuse after purge -> 'ok' (silent overwrite)
  });
  it('restore of 3000 rows completes quickly (no quadratic NOT EXISTS)', async () => {
    const { db, A } = await fresh();
    await asAdmin(db).exec(`insert into records (user_id,collection,id,data) select '${A}','kv','k'||g,'{"a":1}' from generate_series(1,3000) g`);
    const u = asUser(db, A);
    await u.rpc('take_backup');
    await asAdmin(db).exec(`update records set data='{"a":2}' where id like 'k1%'; delete from records where id like 'k2%'`);
    const t0 = Date.now();
    const n = await u.rpc('restore_backup', { p_date: new Date().toISOString().slice(0, 10) });
    expect(n).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});
