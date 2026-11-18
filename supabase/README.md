# Ledger database (Supabase Postgres)

The database is the source of truth for all tracked data; the browser holds a disposable cache.

## Files

| File | Purpose |
|---|---|
| `migrations/0001_init.sql` | original `records` table (history) |
| `migrations/0002_records_upgrade.sql` | adds `version`, `seq`, `created_at`, `device_id`; backfills; constraints; trigger owning `seq`/`updated_at`/`version`; revokes direct writes; realtime |
| `migrations/0003_push_records.sql` | `push_records()`, the only write path |
| `migrations/0004_backups.sql` | `record_backups`, backup/restore/purge functions, pg_cron schedules |
| `migrations/0005_report.sql` | read-only report (constraint validity, row/seq counts, client privileges); its result is what the SQL editor shows after `apply-all.sql` |
| `apply-all.sql` | all migrations concatenated, one paste |
| `schema.sql` | current full schema (same content as `apply-all.sql`) |

After editing or adding a migration run `npm run db:bundle` (`scripts/db-bundle.mjs`) to regenerate both files; `node scripts/db-bundle.mjs --check` (run by CI) fails if they are stale, and `tests/unit/db/db.test.ts` checks that both contain every migration verbatim. The two files differ only in their first header line. Optional: `SUPABASE_DB_URL=... npm run db:apply` applies new migrations from the command line and records them in `public.schema_migrations` (see `docs/DEPLOY.md`).

## Apply

Supabase Dashboard -> SQL Editor -> New query -> paste `supabase/apply-all.sql` -> Run. Everything is idempotent: re-run it any time (also after enabling pg_cron). Existing rows are kept: they get `version = 1` and `seq` in `updated_at` order.

### Constraint report
If a legacy row breaks a new CHECK constraint, the migration prints a NOTICE and leaves that constraint NOT VALID (still enforced for new writes). Inspect with
`select conname, convalidated from pg_constraint where conrelid = 'public.records'::regclass;`

### pg_cron (nightly backup)
Dashboard -> Database -> Extensions -> enable `pg_cron`, then re-run `apply-all.sql`. Schedules created: `ledger-nightly-backup` at 03:15 UTC daily (`run_nightly_backup()`, which also deletes snapshots dated before today minus 14) and `ledger-purge-tombstones` Sundays 03:45 UTC (cron expressions `15 3 * * *` and `45 3 * * 0`). Verify: `select jobname, schedule from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 5;`. Without pg_cron the app can still call `take_backup()` itself.

## Write-path security design
Clients (`authenticated`) have only `SELECT` on `records` (RLS: own rows) and on `record_backups`. INSERT/UPDATE/DELETE are revoked, so versioning cannot be bypassed by a client bug. `push_records` is SECURITY DEFINER with `search_path = public, pg_temp`, checks `auth.uid()` itself and filters every statement by it. A BEFORE trigger additionally owns `seq`, `updated_at` and `version` (even a manual UPDATE in the SQL editor bumps version/seq). Maintenance functions (`run_nightly_backup`, `purge_tombstones`, `_snapshot_user`) are not executable by clients.

Concurrency: a per-user advisory transaction lock serialises writers, so seq values commit in increasing order (a `seq > cursor` pull never skips a late-committing row) and two simultaneous pushes of one item cannot both win; rows are also locked `FOR UPDATE`.

Realtime: `records` is added to `supabase_realtime` (if the publication exists). Default replica identity suffices (primary key contains `user_id`).

## RPC reference (what the client uses)

Pull (plain select, RLS applies, index `(user_id, seq)`):
`select * from records where seq > :cursor order by seq limit :n` -> columns `user_id, collection, id, data, deleted, version, seq, updated_at, created_at, device_id`. Note `version` and `seq` are bigint (PostgREST returns JSON numbers).

`rpc push_records(p_items jsonb, p_device_id text default null) -> jsonb`
- `p_items`: array, max 500 (else error 54000), items `{collection, id, data, deleted, base_version}`; all fields required except `deleted` (default false). Non-array -> error 22023; no auth -> error 28000.
- Result: array in input order of `{collection, id, status, row?, reason?}`.
  - `ok`: `row` = new row. `base_version` 0 and item missing -> insert version 1; `base_version` = current version -> update, version+1.
  - `conflict`: nothing written; `row` = server's current row (also for base_version 0 on an existing item, including tombstones).
  - `gone`: base_version > 0 and item missing; no `row`.
  - `rejected`: `reason` text (unknown collection, id not 1..200 chars or has control chars, data not an object, data > 600000 bytes, bad base_version/deleted); no `row`. Do not retry.
  - `row` = `{collection,id,data,deleted,version,seq,updated_at,device_id}`.
- Tombstones (`deleted: true`) are stored with `data = {}`.

`rpc take_backup() -> {taken_on, row_count, throttled?}` live rows only; writes (overwrites) today's UTC `daily` snapshot, so it replaces the earlier copy of the same date. If a daily snapshot was written in the last 10 minutes it is returned instead with `throttled: true` (not an error).

`rpc list_backups(p_include_safety boolean default false) -> rows {taken_on, row_count, kind, created_at}` newest first; `kind` is `daily` or `pre-restore` (safety copies, hidden unless asked).

`rpc restore_backup(p_date date, p_kind text default 'daily') -> integer` first stores a `pre-restore` safety snapshot; live rows absent from the snapshot become tombstones, snapshot rows are upserted (resurrecting tombstones); touched rows get a new seq and version+1 so every device converges. Rows already identical to the snapshot are not touched. Returns rows touched. Error P0002 if no such backup.

Service/cron only: `run_nightly_backup() -> integer` (users backed up; deletes backups older than 14 days), `purge_tombstones() -> integer` (deletes tombstones older than 90 days that a later daily backup already covers).

`record_backups` has a surrogate `id` PK plus `kind`, with a unique index on `(user_id, taken_on) where kind = 'daily'`, so safety copies never overwrite each other.

## Behaviour notes
- Errors: only validation-class errors (LD001, SQLSTATE 22xxx, 23xxx) become `rejected`; any other error (serialization failure, lock timeout, ...) fails the whole `push_records` call so the client retries.
- Size limit: 600000 bytes of `data::text` (jsonb text form, slightly larger than `JSON.stringify`), checked in `push_records` and the CHECK constraint.
- Version floor: `purge_tombstones` records the purged item's last version in `record_tombstone_floor` (no client access); a recreated id starts at floor + 1, so stale devices get `conflict`.
- `take_backup` / the nightly job never replace today's daily snapshot with one that has < 80% of its rows (returned with `throttled: true`). `take_backup` also deletes the caller's backups older than 14 days.
- `restore_backup` skips snapshot rows that violate the table constraints (NOTICE with the count) instead of aborting.
- Sequence privileges are revoked from clients.

## Restore (manual, from the app or SQL)
From a signed-in client call `restore_backup(date)` (Settings > Backups does this). From the SQL editor `auth.uid()` is null, so the function raises `not authenticated` unless you impersonate the user in the same run: `select set_config('request.jwt.claim.sub','<uuid>',false); select public.restore_backup('2026-11-10');`. Only tested on PGlite, whose stand-in `auth.uid()` reads that setting; the real Supabase `auth.uid()` should also honour it but this was not run on a real project.

## Verify
```
select count(*), max(seq) from records;                              -- rows present, cursor
select collection, count(*) from records group by 1;
select taken_on, row_count, kind from record_backups order by 1 desc;
select jobname, schedule from cron.job;                              -- if pg_cron enabled
select has_table_privilege('authenticated','public.records','INSERT'); -- must be false
```

## Tests
`npx vitest run tests/unit/db` (PGlite; harness API documented at the top of `tests/unit/db/harness.ts`). Never run against a real Postgres or Supabase (PGlite only; its `auth.uid()`, roles and `supabase_realtime` publication are stand-ins created by the harness), so run `apply-all.sql` once on a Supabase branch/project and use the Verify queries.
