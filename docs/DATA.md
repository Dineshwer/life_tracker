# Data: guarantees, failure modes, runbooks

## Guarantees

1. **The database is the source of truth.** Once an item is accepted by `push_records` it is in Postgres, scoped to your user by row level security. The browser copy is a cache.
2. **Wiping a browser loses nothing that has synced.** Sign in again and everything is pulled back. "Reset this device's copy" (Settings > "Where your data lives") does exactly that on purpose; the engine refuses, and changes nothing, if changes have not uploaded yet (the dialog text suggesting they "will be lost" is more alarming than the behaviour).
3. **No silent overwrites.** Writes are versioned (optimistic concurrency). When two devices change the same field the server value wins and your losing value is kept in the conflict list (Settings > Data & sync) so you can restore it. Changes to different fields of one item are merged.
4. **No silent loss of local edits.** Pending changes are derived from the store, not from a queue, so they survive reloads and crashes and are retried until accepted. Signing out with pending changes asks first.
5. **Deleted is recoverable for a while.** Deletes are tombstones (purged after 90 days, by the weekly pg_cron job only, and only once a daily snapshot taken after the deletion exists; without pg_cron they are never purged). Daily server snapshots are kept 14 days (the nightly job deletes snapshots dated before today minus 14). Restoring takes a "pre-restore" safety snapshot first, so a restore is itself undoable.
6. **Bad data is rejected, not stored.** The server enforces a collection allow-list, id rules, object-only data and an item size limit (600,000 bytes of jsonb text; the unused client constant `LIMITS.maxItemBytes` says 512 KiB). The client validates every loaded or imported item (`src/lib/validate.ts`) and quarantines invalid rows.
7. **Server-owned metadata.** Clients cannot set `version`, `seq` or `updated_at`.

What is **not** guaranteed: an edit made on a device that never reconnects (or whose browser data is wiped before the first sync) exists only on that device. There is one `daily` snapshot per UTC date: the nightly job (03:15 UTC, needs pg_cron) and "Back up now" both **overwrite today's** snapshot (Back up now is throttled to once per 10 minutes). So a snapshot reflects the state at its last write and edits since then are not in it. A guard keeps today's snapshot if the new one would have under 80% of its rows (a mass delete), but a smaller mistake followed by "Back up now" or the nightly job replaces today's good copy with the mistake; restore an earlier date instead. Snapshots hold live rows only.

## Failure modes

| Situation | What happens | What you do |
|---|---|---|
| Offline | Edits apply locally and show as waiting to upload. The app and local data work (service worker). On reconnect the engine pushes, then pulls and merges. | Nothing. |
| Two devices edit the same thing | Different fields: merged. Same field: server value wins, the other value is stored as a `server-won` conflict. Remote delete vs local edit: the delete wins (your edit stays in the conflict list); local delete vs remote edit: the edit wins. (The wording the Settings list shows for the second case, "The deletion was kept", is wrong: the code keeps the edit.) | Open Settings > "Recent changes merged from other devices" and press "Restore my version" on the entry the value you wanted; it then syncs as a normal edit. |
| Browser data wiped / new device | Sign in; first sync pulls everything. Server rows win; local-only items (if any) are pushed. | Nothing. |
| Mass "local deletion" that looks like cache loss (store empty and 5+ pending deletions, or 20+ deletions that are 60%+ of known items) | The engine rebuilds from the server instead of deleting everything remotely. Deleting that many items on purpose, one by one, can trip this guard. | Nothing. |
| Session expired / refresh failed | Sync reports an auth error; local data stays usable. | Sign in again. Pending changes are kept and pushed after sign-in. |
| Supabase down or unreachable | Same as offline: status "offline/error", backoff from 1 s up to 5 min. | Wait. Download a file backup if you want a copy meanwhile. |
| Item rejected by the server (invalid) | Quarantined locally until the item changes; not retried in a loop. | Edit or delete the item. |
| Bad / foreign backup file | `parseBackup` refuses non-JSON, non-Ledger, too-large (60 MB) and newer-format files with a plain message. Valid files are sanitised: invalid items are dropped and reported. | Choose another file. |
| Backup from a newer app version | Refused ("update the app"). | Update, then import. |
| Accidental delete of items | Tombstone synced to all devices. | Restore the most recent daily snapshot from before the deletion (see below), or restore a conflict entry. |
| Accidental bad import / bad restore | Server restore: a `pre-restore` safety snapshot exists but it is **not** listed in the Settings backup list (the app lists daily snapshots only; the restore dialog's "come back to it from this list" is inaccurate). File import: only changes this device, then syncs like normal edits. | Server restore: use `restore_backup(date, 'pre-restore')` in SQL (see below). File import: restore a server snapshot from before. |
| Table or function missing (migrations not applied) | Sync shows an error. | Apply migrations: `docs/DEPLOY.md`. |

## Runbooks

### Restore from a daily backup
In the app: Settings > Backups card > Restore next to a day > Restore this backup. The server takes a pre-restore safety snapshot, makes the live rows equal the snapshot (missing rows become tombstones, snapshot rows are upserted) and every device converges on the next sync. The number of rows changed is shown.
From SQL (SQL editor, impersonating the user; run both statements in one run): `select set_config('request.jwt.claim.sub','<user-uuid>',false); select public.restore_backup('YYYY-MM-DD');`. Not verified on a real Supabase project (tested on PGlite with the same setting). To undo a restore: `select public.restore_backup('YYYY-MM-DD','pre-restore');` (find dates with `select * from public.list_backups(true);`).
The nightly job runs only when `pg_cron` is enabled; otherwise snapshots exist only when someone presses "Back up now" (which also deletes that user's snapshots older than 14 days). See `docs/DEPLOY.md`.

### Export everything
- In the app: Settings > Backup file > Download backup file (`ledger-backup` v2 JSON: all collections incl. kv and wake, plus settings; file name `ledger-backup-YYYY-MM-DD.json`). Re-import with "Restore from file": it shows what will be added/replaced/removed first, replaces each list wholesale on this device, then syncs up as normal edits.
- From the database (all users, SQL editor): `select collection, id, data, deleted, version, updated_at from public.records order by seq;` and export CSV/JSON from the results pane, or `pg_dump --data-only -t public.records "$SUPABASE_DB_URL"`.

### Rotate keys
- **Publishable (anon) key:** designed to be public (it ships in the JS bundle); it can only do what RLS and function grants allow. Rotate it if you want to invalidate old bundles: Supabase > Project Settings > API > create a new publishable key, update `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel, redeploy, then revoke the old key.
- **Secret / service_role key:** the app never uses it. If it was ever exposed, rotate it in the same settings page.
- **Database password:** Supabase > Project Settings > Database > Reset database password; update wherever `SUPABASE_DB_URL` is stored (your shell; never the repo).
- **User passwords / sessions:** a user changes the password in Supabase Auth; "sign out all sessions" revokes refresh tokens.

### Migrate the database
1. Add `supabase/migrations/000N_name.sql`, idempotent (`create ... if not exists`, `create or replace`, guarded `alter`).
2. `npm run db:bundle` (regenerates `supabase/apply-all.sql`).
3. Either paste `supabase/apply-all.sql` into the Supabase SQL editor, or run `SUPABASE_DB_URL=... npm run db:apply` (applies only new files, each in a transaction, recorded in `public.schema_migrations`; `--dry-run` lists what would run).
4. Take a snapshot first ("Back up now") for anything that rewrites data. Never edit an applied migration: add a new one (db:apply warns on checksum drift).

### Delete the account data
- Everything for one user: in the SQL editor `delete from auth.users where id = '<uuid>';` cascades to `records` and `record_backups`. (Or Supabase > Authentication > Users > delete.)
- Local copy: browser site data for the app origin (or Settings > Reset this device's copy followed by clearing site data).
- All data of the project: delete the Supabase project.
