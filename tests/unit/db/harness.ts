/* PGlite harness that imitates the parts of Supabase our SQL depends on. STABLE API: reused by the TESTS and E2E agents.
 *
 *   createDb(opts?)        -> Promise<PGlite>   fresh in-memory Postgres with the Supabase stubs and ALL migrations applied.
 *       opts.upTo: 'stubs' | '0001' | 'all' (default 'all'). 'stubs' = just auth/roles/publication; '0001' = also the legacy table
 *       (use it to test the upgrade); then call applyMigrations(db) / applyAllSql(db) yourself.
 *   applyMigrations(db)    run supabase/migrations/*.sql in order (re-runnable).
 *   applyAllSql(db)        run supabase/apply-all.sql (re-runnable: idempotency).
 *   createUser(db, id?)    insert into auth.users, returns the uuid (random if omitted).
 *   asUser(db, userId)     -> Session acting as the Supabase `authenticated` role with that JWT sub (row level security applies,
 *                          direct writes on records are denied exactly like in production). Every call is its own transaction.
 *       s.query<T>(sql, params?) -> rows T[]          s.exec(sql)  (no result)
 *       s.rpc(name, args?)       -> the function's scalar/JSON result, or an array of rows for table-returning functions (list_backups) (named args object, e.g. {p_items: [...], p_device_id: 'd'})
 *       s.push(items, deviceId?) -> PushResult[]      shortcut for rpc('push_records', ...)
 *       s.tx(fn)                 run several statements atomically: fn(q) where q(sql, params) -> rows
 *   asUser(db, null)       -> anonymous session (role anon, no sub).
 *   asAdmin(db)            -> superuser session (what the SQL editor / pg_cron / service role effectively is). Same Session API.
 *   item(collection, id, data?, base_version?, deleted?) -> a push item.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const SUPABASE_DIR = join(__dirname, '..', '..', '..', 'supabase');
export const MIGRATION_FILES = readdirSync(join(SUPABASE_DIR, 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
export const migrationSql = (f: string) => readFileSync(join(SUPABASE_DIR, 'migrations', f), 'utf8');

const STUBS = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  do $$ begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  end $$;
`;

export async function createDb(opts: { upTo?: 'stubs' | '0001' | 'all' } = {}): Promise<PGlite> {
  const upTo = opts.upTo ?? 'all';
  const db = new PGlite();
  await db.exec(STUBS);
  if (upTo === 'stubs') return db;
  await db.exec(migrationSql(MIGRATION_FILES[0]));
  if (upTo === '0001') return db;
  for (const f of MIGRATION_FILES.slice(1)) await db.exec(migrationSql(f));
  return db;
}
export async function applyMigrations(db: PGlite) { for (const f of MIGRATION_FILES) await db.exec(migrationSql(f)); }
export async function applyAllSql(db: PGlite) { await db.exec(readFileSync(join(SUPABASE_DIR, 'apply-all.sql'), 'utf8')); }

export async function createUser(db: PGlite, id: string = randomUUID()): Promise<string> {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@test.local`]);
  return id;
}

type Q = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
export interface Session {
  query: Q;
  exec(sql: string): Promise<void>;
  rpc<T = any>(name: string, args?: Record<string, unknown>): Promise<T>;
  push(items: unknown[], deviceId?: string): Promise<any[]>;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

function session(db: PGlite, role: string | null, sub: string | null): Session {
  const setup = async (t: { query: PGlite['query'] }) => {
    if (role) await t.query(`set local role ${role}`);
    await t.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
  };
  const tx: Session['tx'] = (fn) =>
    db.transaction(async (t) => {
      await setup(t);
      return fn(async (sql, params) => (await t.query(sql, params as any[])).rows as any[]);
    });
  const s: Session = {
    tx,
    query: (sql, params) => tx((q) => q(sql, params)),
    exec: async (sql) => { await db.transaction(async (t) => { await setup(t); await t.exec(sql); }); },
    async rpc(name, args = {}) {
      const keys = Object.keys(args);
      const call = `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}${k === 'p_items' ? '::jsonb' : ''}`).join(', ')})`;
      const params = keys.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
      const rows = await tx((q) => q<any>(call, params));
      // scalar/JSON function (one column) -> its value; table-returning function (several columns) -> the array of rows
      const cols = rows.length ? Object.keys(rows[0]) : [];
      return (cols.length === 1 ? rows[0][cols[0]] : rows) as any;
    },
    push(items, deviceId) {
      return s.rpc('push_records', deviceId === undefined ? { p_items: items } : { p_items: items, p_device_id: deviceId });
    },
  };
  return s;
}
export const asUser = (db: PGlite, userId: string | null): Session => session(db, userId ? 'authenticated' : 'anon', userId);
export const asAdmin = (db: PGlite): Session => session(db, null, null);

/** A valid push item. */
export const item = (collection: string, id: string, data: unknown = { id, v: 1 }, base_version = 0, deleted = false) =>
  ({ collection, id, data, deleted, base_version });
