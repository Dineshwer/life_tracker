#!/usr/bin/env node
/* Applies supabase/migrations/*.sql, in order, to a Postgres database.
     SUPABASE_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' npm run db:apply
   Flags:  --dry-run   print what would be applied, change nothing
           --list      show applied / pending and exit
   Each file runs in its own transaction and is recorded in public.schema_migrations (name, checksum, applied_at), so a re-run only applies new files.
   A recorded file whose contents changed since it was applied is reported (checksum drift) but NOT re-applied: add a new migration instead.
   The connection string is read from the environment only and is never written anywhere. Use the DIRECT connection (port 5432) or the session pooler. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dry = process.argv.includes('--dry-run');
const listOnly = process.argv.includes('--list');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Set SUPABASE_DB_URL (Supabase -> Project Settings -> Database -> Connection string). It is never committed.'); process.exit(2); }

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await client.connect();
const summary = { applied: [], skipped: [], drift: [], failed: null };
try {
  await client.query(`create table if not exists public.schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  await client.query('alter table public.schema_migrations enable row level security'); // no policies: unreachable through the API
  const done = new Map((await client.query('select name, checksum from public.schema_migrations')).rows.map((r) => [r.name, r.checksum]));
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    if (done.has(f)) { summary.skipped.push(f); if (done.get(f) !== sha(sql)) summary.drift.push(f); continue; }
    if (listOnly || dry) { summary.applied.push(f + ' (pending)'); continue; }
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into public.schema_migrations (name, checksum) values ($1, $2)', [f, sha(sql)]);
      await client.query('commit');
      summary.applied.push(f);
    } catch (e) {
      await client.query('rollback').catch(() => {});
      summary.failed = { file: f, error: e.message };
      break;
    }
  }
} finally { await client.end(); }

console.log(`${dry || listOnly ? 'DRY RUN / LIST: ' : ''}migrations`);
console.log(`  already applied: ${summary.skipped.length ? summary.skipped.join(', ') : '-'}`);
console.log(`  ${dry || listOnly ? 'would apply' : 'applied now'}: ${summary.applied.length ? summary.applied.join(', ') : '-'}`);
if (summary.drift.length) console.log(`  WARNING checksum drift (edited after being applied; not re-applied): ${summary.drift.join(', ')}`);
if (summary.failed) { console.error(`  FAILED ${summary.failed.file}: ${summary.failed.error}  (rolled back; later files not run)`); process.exit(1); }
