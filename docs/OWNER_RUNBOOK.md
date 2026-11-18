# Ledger owner runbook

For you, the owner, using the Supabase dashboard and the Vercel website. No command line needed except where marked. Read top to bottom the first time; after that jump to the section you need.

**Honest status.** The sync system and the database upgrade were tested on a pretend Supabase (an in-memory Postgres plus a mock server), never on your real project. So this guide has "check it worked" queries after every step. Menu names in Supabase and Vercel change now and then: if a name differs slightly, look for the nearest one.

**Golden rules**
1. Your data lives in the Supabase database. Each device only keeps a copy it can throw away.
2. Take a backup file from the app (Settings > Backup file > Download backup file) before any upgrade. Keep it somewhere that is not this phone.
3. Do the upgrade steps in order. If a check fails, stop and use "If something goes wrong" below.

---

## 1. First-time upgrade (do this once)

Time: about 20 minutes. Do it when you will not be using the app.

### Step 1. Save a safety copy
1. Open the app on the device that has your latest data. Settings > Backup file > **Download backup file**. A file `ledger-backup-<date>.json` is saved.
2. Settings > Data & sync should say **Synced**. If it says something else, fix that first (section 4).

### Step 2. Apply the database update
1. Supabase dashboard > your project > **SQL Editor** > **New query**.
2. Open the file `supabase/apply-all.sql` from the repo (on GitHub: the file in the `supabase` folder). Select all, copy, paste into the editor.
3. Press **Run**. Wait until it finishes. It is safe to run again; it never deletes your rows.
4. The result table at the bottom is a built-in report. Look for: every `constraint` line says `validated`; the `records` line reads `rows / distinct seq / min version` like `412 / 412 / 1` (first two numbers equal, last number 1 or more); `client privileges` says `false`; `backups` is a number (0 is fine the first time).
5. It may print `NOTICE` lines. A notice saying a constraint is "left NOT VALID" means an old row broke a rule; the app still works (see 3e).

### Step 3. Check the database (paste each query as a new run)

**3a. Your rows are still there and have versions**
```sql
select count(*), max(version), max(seq) from public.records;
```
Expect: `count` is about the number of items you had (not 0 if you had data), `max(version)` is 1 or more, `max(seq)` is a number about equal to `count` or higher.

**3b. Browsers can no longer write directly (MUST be false)**
```sql
select has_table_privilege('authenticated','public.records','INSERT') as can_insert,
       has_table_privilege('authenticated','public.records','UPDATE') as can_update,
       has_table_privilege('authenticated','public.records','DELETE') as can_delete,
       has_table_privilege('authenticated','public.records','SELECT') as can_read,
       has_table_privilege('anon','public.records','SELECT')          as anon_can_read;
```
Expect: `false, false, false, true, false`.

**3c. The functions exist**
```sql
select proname from pg_proc
where pronamespace = 'public'::regnamespace
order by proname;
```
Expect these 10 names: `_item_valid`, `_row_json`, `_snapshot_user`, `list_backups`, `purge_tombstones`, `push_records`, `records_before_write`, `restore_backup`, `run_nightly_backup`, `take_backup`.

Also the tables: `select tablename from pg_tables where schemaname='public' order by 1;` should list `record_backups`, `record_tombstone_floor` and `records` (plus `schema_migrations` only if you ever used `npm run db:apply`).

**3d. Who may run what**
```sql
select has_function_privilege('authenticated','public.push_records(jsonb,text)','EXECUTE')  as push_ok,
       has_function_privilege('authenticated','public.take_backup()','EXECUTE')             as backup_ok,
       has_function_privilege('authenticated','public.run_nightly_backup()','EXECUTE')      as cron_job_open_to_users;
```
Expect: `true, true, false`.

**3e. Rules (constraints) and policies**
```sql
select conname, convalidated from pg_constraint
where conrelid = 'public.records'::regclass and contype = 'c' order by 1;
```
Expect 6 rows, all `true`: `records_collection_ok`, `records_data_object`, `records_data_size`, `records_id_len_ok`, `records_tombstone_small`, `records_version_pos`. A `false` means an old row breaks that rule: new writes are still checked, so just note it.
```sql
select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2;
```
Expect exactly 2 rows: `record_backups / backups select own / SELECT` and `records / records select own / SELECT`. If you still see a policy called `own rows`, the upgrade did not finish: run `apply-all.sql` again.

**3f. Live updates are switched on**
```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```
Expect a row `records`. If it is empty, live updates will not work, but sync still works every 20 seconds to 1 minute. Dashboard > Database > Replication / Publications can add the table.

**3g. Settings row fix (run once; harmless if not needed)**
The upgrade tests found that the old app stored your settings row without an `id` field inside it, which the new app's checker refuses, so your theme/targets would not sync. This adds it:
```sql
update public.records
set data = data || jsonb_build_object('id', 'settings')
where collection = 'meta' and id = 'settings' and not (data ? 'id');
```
Expect "Success. 1 row" the first time and 0 rows afterwards. (Finding from `tests/unit/upgrade/s2.test.ts`, marked as a defect there; if the app code has since been fixed to cope, this does nothing harmful.)

> **If you see** "relation public.records does not exist" or any red error in step 2: copy the full message, do nothing else, the app keeps working as before until you do step 6. Run the file again; if it still fails, ask for help with that message.

### Step 4. Turn on automatic daily backups (pg_cron)
1. Dashboard > **Database** > **Extensions** > search `pg_cron` > switch it on.
2. Go back to **SQL Editor** and **run `supabase/apply-all.sql` again** (this creates the schedules).
3. Check:
```sql
select jobname, schedule, active from cron.job;
```
Expect 2 rows: `ledger-nightly-backup` `15 3 * * *` and `ledger-purge-tombstones` `45 3 * * 0`, both active `true`. (03:15 UTC is 08:45 in India.)
4. The next day check it ran:
```sql
select status, start_time, return_message from cron.job_run_details order by start_time desc limit 5;
```
Expect `succeeded`. And `select taken_on, row_count, kind from public.record_backups order by created_at desc limit 5;` shows a row dated today (UTC).

> **If you see** no rows in `cron.job`: pg_cron was not on when you ran the file. Switch it on, run the file again. **If** `cron` "does not exist": pg_cron is not enabled. Without it there are only manual backups ("Back up now" in the app).

### Step 5. Auth settings
1. Dashboard > **Authentication** > **URL Configuration**.
2. **Site URL**: your live app address, e.g. `https://your-app.vercel.app` (no trailing slash).
3. **Redirect URLs**: add the same address, and `http://localhost:5173` if you test locally.
4. Save. Check the Vercel project has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (Vercel > project > Settings > Environment Variables). Those are the only two. Never put the secret key or the database password there.

### Step 6. Put the new app online
1. Push the new code to `main` on GitHub (or in Vercel > Deployments, make sure the newest deployment is **Ready** and is **Current**).
2. **Why the order matters:** the old app saved by writing straight to the table. Step 2 switched that off. Until the new app is live, the old app can show your data but **cannot save to the cloud** (edits stay on that device). So do Step 2 and Step 6 close together, not days apart.
3. On every device: close the app completely and open it again (installed app: swipe it away). The new version loads by itself on the next open. Do it twice if the first open still looks old.
4. Settings > Data & sync should show **Synced just now**.

### Step 7. Prove sync works from two devices
1. Device A (phone): add a habit called `sync test`. Wait for Settings > Data & sync to say Synced.
2. Device B (laptop, or another browser): sign in. `sync test` should appear within a few seconds (Settings says "Live updates: On") or within a minute at most.
3. On B, rename it to `sync test 2`. On A it should change.
4. Delete it on A. It disappears on B.
5. Then in Supabase run `select collection, id, deleted, version from public.records order by seq desc limit 5;` The top rows are your test: `deleted = true`, `version` 3 or more.
6. Press **Back up now** (Settings > Backups). A line "Backed up N items on <today>" appears and today's date shows in the list.

> **If B does not show the habit:** Settings > Data & sync > **Sync now** on both. Still nothing: section 4, "Sync error".

---

## 2. Day to day: what the app tells you

Banner at the top of the app (only appears when something needs you):

| You see | Colour | Meaning | Do |
|---|---|---|---|
| "You are offline. N changes are saved on this device and will upload when you are back online." | amber/accent | No internet. Nothing is lost. | Nothing. It uploads by itself later. |
| "N changes have not uploaded yet. They are saved on this device." + Retry | amber/accent | Online, but changes did not go up for over a minute. | Press Retry. If it stays, open Settings > Data & sync and read the status line; see section 4. |
| "Sync has a problem: ... Your data is safe on this device." + Retry | **red** | The server refused or could not be reached. The text after the colon says why. | Press Retry. Common texts below. |

Common red texts:
- "Your session expired. Sign in again to keep syncing." Sign out (Settings > Data & sync > Sign out; it warns you if something has not uploaded) and sign in again. Waiting changes are kept and upload after sign in.
- "Could not reach the server..." Internet or Supabase is down. Wait; it retries by itself (1 s, then slower, up to every 5 minutes).
- "Could not find the function public.push_records..." or "column ... seq does not exist": the database update (Step 2) was not applied to this project. Do Step 2.
- "N items were refused by the server and not synced: ..." One item is invalid (too big, bad id). Edit or delete that item. Everything else syncs.

Settings > Data & sync shows: a status line (Synced / Offline / Problem), Last sync, Waiting to upload, Live updates On/Off, device id, account. Other cards: "Where your data lives" (Reset this device's copy), "Recent changes merged from other devices", "Backups", "Backup file".

**Two devices changed the same thing.** Different fields are merged. If both changed the same field, the server's value stays and your other value is listed under Settings > "Recent changes merged from other devices": press **Restore my version** to bring it back. Delete versus edit: if you delete something on one device while another device edits it, the edit wins and the item comes back. If another device deleted something you were editing, it is removed from yours, and your version is listed in the same place so you can restore it.

---

## 3. Backups

There are three kinds. All are separate from each other.

| Kind | Where | How many | Made |
|---|---|---|---|
| Daily server backup | In your Supabase database, listed in Settings > Backups | One per day, last about 14 days | Each night 03:15 UTC (needs pg_cron) and when you press **Back up now** |
| Safety copy before a restore | In your database; not listed in Settings (SQL only) | One per restore, same retention | Automatically right before every restore |
| Backup file | A `.json` file on your device | As many as you keep | Settings > Backup file > Download backup file |

**Important:** there is only one daily backup per date and "Back up now" (and the nightly job) **overwrites today's**. A safety rule keeps today's copy if the new one would have fewer than 80% of the items (a big accidental delete), but a smaller mistake is not protected. So after a mistake, do **not** press Back up now: restore an earlier day (yesterday is intact). Back up now can only run once per 10 minutes. The app shows "Backed up N items" even when the safety rule kept the older copy.

### Take a backup
- App: Settings > Backups > **Back up now**, or Settings > Backup file > **Download backup file** (use the file for anything important: it is outside Supabase).

### Restore from a daily backup (accidental delete, wrong edits)
1. Settings > Backups > find the **last day before the mistake** > **Restore**.
2. Read the box. **Every device changes to match that day; anything since then disappears.** Press **Restore this backup**.
3. It says "Restored N items". Other devices update within a minute.
4. Changed your mind? The app does not list the safety copy. In Supabase SQL Editor (replace the user id with yours: Authentication > Users > copy the UID; use today's date):
```sql
select set_config('request.jwt.claim.sub', 'PASTE-YOUR-USER-UID', false);
select * from public.list_backups(true);
select public.restore_backup('YYYY-MM-DD', 'pre-restore');
```
Run all of this in one go. The second line shows what exists; the third restores the safety copy. (This SQL path was tested on the pretend database only.)

### Restore from a backup file
Settings > Backup file > **Restore from file** > choose the file. It shows what will be added, replaced or removed before doing anything. It replaces each list on **this device**, then syncs up like normal edits to every device. Files from newer app versions or that are not Ledger backups are refused with a message.

### Export everything
- App: Download backup file (above). Re-importable.
- Supabase: SQL Editor, run `select collection, id, data, deleted, version, updated_at from public.records order by seq;` then use the **Download CSV** button in the results.

---

## 4. If something goes wrong

**Sync error (red banner)** Read the text, match it in section 2. Then: Settings > Data & sync > **Sync now**. Then check Supabase is up (Dashboard shows project status). Then close and reopen the app. Your data is not lost by an error; it waits on the device.

**Stuck "waiting to upload" for a long time**
1. Settings > Data & sync > Sync now. 2. Check you are signed in (Account row shows your email). 3. If the red text says an item was refused, edit or delete that item. 4. Still stuck: Settings > Backup file > **Download backup file** (it includes the waiting changes), then Settings > "Where your data lives" > Reset this device's copy (it refuses while changes are still unsent, which protects them), sign out, sign in.

**Something from before the upgrade is missing in the app** The new app refuses items that break its size rules (for example a title over 1000 characters, a body photo over about 400 KB, a "who" over 500 characters), which the old app accepted. They are not deleted: they stay in the database but are hidden in the app. Find them with `select collection, id, left(data::text, 80) from public.records where collection = 'tasks' and not deleted;` (change `tasks` to the list you miss). Fix by editing the item in the app, or ask for help. (Finding from `tests/unit/upgrade/s2.test.ts`; not run on your real data.)

**Data looks wrong on one device only** Settings > "Where your data lives" > **Reset this device's copy**. It downloads everything again from your account.

**Data looks wrong everywhere** Do not press Back up now. Find the last good day in Settings > Backups and restore it (section 3).

**Accidentally deleted something** First look under Settings > "Recent changes merged from other devices" (Restore my version). Otherwise: Download backup file first (so today's work is kept), then restore the last daily backup from before the deletion (section 3). Everything you did after that day is removed by the restore, so re-enter it from the downloaded file if needed. Do not press Back up now first.

**New phone or wiped phone** Open the app, sign in. Everything downloads. Nothing to restore. (Only changes that never reached the cloud before the wipe are gone.)

**Lost or stolen laptop/phone** Supabase > Authentication > Users > your user: change the password (below). Whether that signs the lost device out immediately was not verified: Supabase may keep an existing session until it expires. Data is not encrypted at rest on the device. Your data on the server is protected by your sign-in, so changing the password is the step that matters.

**Locked out / forgot password** The app has no "forgot password" screen. In Supabase > Authentication > Users you can send a recovery email, but that link brings you to the app, which cannot set a new password. Use the SQL method below.

### Change the account password (SQL method)
```sql
update auth.users
set encrypted_password = extensions.crypt('NEW-PASSWORD-HERE', extensions.gen_salt('bf'))
where email = 'you@example.com';
```
Expect "Success. 1 row" (not verified against your project; if it errors on `extensions.crypt`, try `crypt` without `extensions.`). Do not leave the new password in the query history: clear the editor.

### Rotate keys
- **Publishable key** (`sb_publishable_...`) is meant to be public: it is inside the app. Rotate it only if you want old copies of the app to stop working: Supabase > Project Settings > **API Keys** > create a new publishable key > Vercel > Settings > Environment Variables > change `VITE_SUPABASE_PUBLISHABLE_KEY` > **Redeploy** (the value is baked in at build time) > then delete the old key in Supabase.
- **Secret / service_role key**: the app never uses it. If it was ever pasted anywhere, rotate it on the same page.
- **Database password**: Project Settings > Database > **Reset database password**. Update wherever you saved it (your own notes, never the repo or Vercel). The app does not use it.

---

## 5. Updating the app later, and rolling back

**Normal update:** push to `main`, Vercel builds and shows **Ready**, reopen the app. If a release adds a database file (a new number in `supabase/migrations/`), run `supabase/apply-all.sql` in the SQL Editor **before** pushing, then run the checks in Step 3 that apply. The scripts regenerate it: `npm run db:bundle`.

**Roll back the app on Vercel:** Vercel > your project > **Deployments** > find the last good one > the **...** menu > **Instant Rollback** (or **Promote to Production**). Devices pick it up the next time they open the app.

**What rolling back does to the database: nothing.** The database stays upgraded. That means:
- Rolling back to a build **from after** the upgrade (any build with "Data & sync" in Settings): safe.
- Rolling back to a build **from before** the upgrade: that old app can show your data but **cannot save to the cloud** (direct writes are switched off). Its edits stay on that device only. Do not roll back that far; fix forward instead. If you must, you will not lose cloud data, but anything entered meanwhile on the old build is stuck on that device until you go forward again.
- The database upgrade is not meant to be undone. If you ever need the old table contents, restore a daily backup or a backup file.

**If the new app misbehaves right after a release:** roll back to the previous good deployment (above), then tell whoever maintains the code what you saw (screenshot of Settings > Data & sync).

---

## 6. Quick reference

| I want to | Do |
|---|---|
| See if sync works | Settings > Data & sync, top line says Synced |
| Force a sync | Settings > Data & sync > Sync now |
| Download my data | Settings > Backup file > Download backup file |
| Undo a mistake | Settings > Backups > Restore (pick the day before) |
| Check the database is set up | Step 3 queries |
| Check nightly backups run | `select * from cron.job_run_details order by start_time desc limit 5;` |
| Start fresh on a device | Settings > Where your data lives > Reset this device's copy |

More detail: `docs/DEPLOY.md`, `docs/DATA.md`, `supabase/README.md`.
