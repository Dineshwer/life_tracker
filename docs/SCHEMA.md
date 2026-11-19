# Ledger relational schema (proposal for owner review)

Status: DRAFT. Nothing here is applied anywhere. The SQL is `supabase/drafts/0008_typed_tables.sql` (not in `migrations/`, so the bundler ignores it).
It was exercised only on a throwaway in-memory Postgres (PGlite) with seeded data for every collection: migration, round trip of every
item shape, push (ok / conflict / gone / rejected / delete / resurrect), pull cursor, RLS, backup and restore. It has NOT been run on a real
Supabase project. The client (`src/**`) is untouched by this task; the small client change that is needed is listed in section 9.

## 1. What changes, in plain words

Today every piece of data (a habit, a task, a workout...) is one row of `public.records` with a `collection` name and a free-form JSON blob
in `data`. The database cannot tell a habit from a typo. The proposal: **one table per kind of data, with real columns** (dates are dates,
XP is a whole number, "stat" can only be body/mind/skill/discipline), keys, and CHECK rules copied from `src/lib/validate.ts`.

What does NOT change: the sync protocol. The app still sends and receives the same JSON objects (`{id, name, stat, ...}`), the server still
returns `ok / conflict / gone / rejected`, versions still guard against lost updates, and one cursor (`seq`) still orders every change.
The server converts JSON to columns on the way in and columns back to the same JSON on the way out, so the app's data shape does not change.

## 2. Entity diagram

```
auth.users (Supabase)
   |  1
   |  owns (every table below has user_id, ON DELETE CASCADE)
   v  *
 settings (1 row/user)      preferences (key,value)        wake_log (one per day)
 habits ---------------- habit_logs            (habit_logs.habit_id -> habits.id, logical, see 6)
   ^  \------------------ routine_blocks        (routine_blocks.habit_id -> habits.id, logical)
   |
 tasks <-- tasks.parent_id (subtask -> parent, logical self reference)
 workouts 1---* workout_sets            (real FK, cascade)
          1---* workout_queue_items     (real FK, cascade)
 body_log 1---* body_measurements       (real FK, cascade)
 courses  1---* course_lectures         (real FK, cascade)
 journal_entries   xp_events   rewards   books   conversations   rejections
 saved_videos   channels   one_logs
 record_backups (snapshots, unchanged)   record_tombstone_floor (internal)   _sync_registry (internal)
 public.records  (OLD table, kept untouched and frozen read-only after cutover)
 shared:  ONE sequence sync_seq  ->  every table's `seq`  ->  ONE pull cursor
```

## 3. Columns every user-data table has

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| user_id | uuid | no | | owner; FK to `auth.users(id)` ON DELETE CASCADE; first column of the primary key |
| id (or `key`) | text (`ledger_id`: 1..200 chars, no control chars) | no | | the app's own item id; primary key is `(user_id, id)` |
| version | bigint | no | 1 | +1 on every accepted write; CHECK >= 1; set by trigger, never by the client |
| seq | bigint | no | trigger | next value of the shared `sync_seq`; set by trigger on every insert/update |
| deleted | boolean | no | false | soft delete (tombstone), see 7 |
| device_id | text | yes | | last writing device, max 100 chars (diagnostics) |
| created_at / updated_at | timestamptz | no | now() | `updated_at` is the server clock, set by trigger |

Every table also has: unique index `(user_id, seq)` (the pull path), RLS enabled, policy "select own" (`auth.uid() = user_id`), `SELECT`
granted to `authenticated` and nothing else (no INSERT/UPDATE/DELETE for any client role), a BEFORE INSERT/UPDATE trigger that assigns
seq/version/updated_at, and membership of the `supabase_realtime` publication. Child tables have RLS + select-own but no sync columns.

Shared column types ("domains", one place to change a rule): `ledger_date` (date 1970..2200), `ledger_stat`, `ledger_unit` (kg/bw/sec),
`ledger_score` (smallint 1..5), `ledger_text` (<= 2,000 chars), `ledger_longtext` (<= 200,000), `ledger_topic`, `ledger_fin_sub`,
`ledger_list` (mine/suggested/hidden), `ledger_origin` (pick/suggest/custom). Enums are CHECK-based domains, not PostgreSQL ENUM types,
because adding a topic or a unit later is one `ALTER DOMAIN`, while ENUM values are painful to change.

## 4. Tables

Names: I kept the requested names. Changes: `habit_logs`/`routine_blocks`/`saved_videos`/`journal_entries`/`xp_events` follow the list;
the settings table is `settings`; `kv` becomes `preferences`. A column is NULL = the optional field is absent in the app's JSON (to_json omits it).
"All CHECKs" below are in addition to the domain rules. Index lists omit the `(user_id, seq)` index that every table has.

### habits (replaces `habits`)
Purpose: a habit definition. Columns: `name` text NN 1..200; `stat` ledger_stat NN; `xp` int NN 0..100000; `minimum` text 0..2000;
`archived` bool; `cadence_type` text NN (daily|weekly|days); `cadence_per_week` smallint 1..7; `cadence_days` smallint[] (values 0..6, max 7 entries);
`unit_label` text <=100; `unit_target` numeric 0..1e6.
CHECKs: cadence shape (daily has neither extra field, weekly needs per_week, days needs days); unit_label and unit_target are both set or both null.
Why not jsonb for cadence: it is three fixed shapes, so three typed columns plus a shape CHECK validate it.

### habit_logs (replaces `habitLogs`)
Purpose: one completion of a habit on a day. `habit_id` ledger_id NN; `log_date` date NN; `level` text NN (full|min); `amount` numeric 0..1e7; `note` <=200,000.
Indexes: `(user_id, habit_id, log_date)`, `(user_id, log_date)`. No unique (habit, day): the app dedupes "two devices logged the same day" itself
(smallest id wins); a unique constraint would permanently reject the loser's push. `habit_id` has no enforced FK (section 6).

### tasks (replaces `tasks`)
Purpose: to-do items. The type has NO embedded subtask list: a subtask is a task whose `parentId` points to another task, so there is no `task_subtasks` table;
it is the self reference `parent_id`. Columns: `title` NN 1..1000; `done` bool NN; `done_at` timestamptz; `task_date` date; `context` NN (job|agency|personal|learning);
`tags` text[] NN default '{}' (<=50 tags, each <=100 chars, GIN index; a child table would add a join for a plain list of labels);
`parent_id` ledger_id; `recurrence_every` (day|week|month) + `recurrence_interval` smallint 1..366 (both set or both null); `horizon` (today|short|long);
`effort` smallint NN 1..3; `stat` NN. Indexes: `(user_id, task_date)`, `(user_id, parent_id)` partial, open-tasks partial `(user_id, task_date) where not done and not deleted`, GIN(tags).

### routine_blocks (replaces `blocks`)
Purpose: the daily routine template. `title` NN 1..200; `start_time`, `end_time` time NN (whole minutes; JSON "HH:MM" both ways);
`day_kind` NN (weekday|weekend|all); `kind` NN (fixed|agency|habit|focus|free); `fixed` bool; `habit_id` (logical reference). Index `(user_id, habit_id)` partial.

### workouts + workout_sets + workout_queue_items (replace `workouts`)
Nested data with real structure becomes child tables. `workouts`: `workout_date` NN; `name` NN <=200 (may be empty); `notes`; `plan_id` text <=200 (it names a
plan entry that lives in `preferences`, not a table, so it stays text); `has_queue` bool NN (the app distinguishes "no queue" from "empty queue").
`workout_sets` PK `(user_id, workout_id, position)`: `id`, `exercise` <=200, `reps` int 0..100000, `weight` numeric 0..100000, `unit` kg|bw|sec, `note` <=2000;
position 0..999 (the old 1000 sets cap). `workout_queue_items` PK `(user_id, workout_id, position)`: `id`, `name`, `sets` int 0..1000, `reps`, `unit`,
`demo`, `instructions` (the app calls it `text`), `note`, `skipped`; position 0..499. Both: composite FK `(user_id, workout_id)` -> `workouts(user_id, id)` ON DELETE CASCADE.
`position` is the key (not the item id) so duplicate item ids inside old data can never block a write; order is kept by it.

### body_log + body_measurements (replace `body`)
`body_log`: `entry_date` NN; `weight_kg` numeric 1..1000; `measurements_set` bool NN; `photo` text <=400,000 (a data URL today; see open question 4).
`body_measurements` PK `(user_id, entry_id, name)`: `name` 1..200 (user-chosen label, e.g. "waist"), `value` numeric 0..10000; FK cascade. The client limit of 100 measurements per entry is not enforced by the database.
This is a name -> number map with user-defined keys: rows in a child table, not jsonb.

### journal_entries (replaces `journal`)
`entry_date` NN; `body` ledger_longtext NN; `kind` NN (daily|weekly); `mood`, `energy` ledger_score (1..5). Index `(user_id, entry_date)`.

### rewards
`title` NN 1..300; `cost` int NN 0..10,000,000; `claimed_at` timestamptz.

### xp_events (replaces `xp`)
`event_date` NN; `stat` NN; `amount` int NN -100000..100000; `reason` NN <=500; `ref` text <=200 (e.g. `wake:2026-11-10`). Indexes: `(user_id, event_date)`, `(user_id, ref)` partial.
No unique on `ref`: the app dedupes same-`ref` events deterministically (smallest id wins).

### books
`title` NN 1..500; `author` <=300; `status` NN (reading|done|queued); `kind` (self|story); `pages`, `page` int 0..100000; `started_on`, `finished_on` date; `rating` smallint 0..5.
(`startedAt/finishedAt` are plain strings in the client schema, in practice `YYYY-MM-DD`; they become real dates, see risk R4.)

### conversations
`convo_date` NN; `who` NN <=300; `note` <=200,000.

### rejections
`rejection_date` NN; `logged_at` timestamptz NN (the app's `createdAt`); `what` NN <=200,000; `who` <=500; `note`.

### saved_videos (replaces `videos`)
`yt_id` NN 1..64; `title` NN <=500; `tag` NN (learn|fun); `added_at` timestamptz NN; `watched_at` timestamptz. Index `(user_id, yt_id)`.

### channels
`handle` NN 1..200; `cid` <=100; `topic` NN (the 10 topics plus legacy sec/per/code); `sub` ledger_fin_sub; `name` <=200; `about` <=500; `list_name` (mine|suggested|hidden); `origin` (pick|suggest|custom).

### courses + course_lectures (replace `courses`)
`courses`: `kind` NN (playlist|link); `title` NN 1..300; `author` <=200 (the app's `by`); `topic` ledger_topic NN; `sub`; `list_name` NN; `origin` NN; `url` <=500;
`lecture_count` int 0..100000; `about` <=500; `lectures_set` bool NN; `lectures_fetched_at` timestamptz (the app's `videosAt`, ms epoch <-> timestamptz, exact to the millisecond).
`course_lectures` PK `(user_id, course_id, position)` position 0..499 (max 500 lectures): `yt_id` 1..64, `title` <=300, `duration_s` int 0..10,000,000; FK cascade.
The app's `[ytId, title, seconds][]` triples become rows: lectures are real, queryable structure.

### one_logs (replaces `oneLogs`)
`log_date` NN; `exercise` NN (pullups|dips|pushups|rows|pikes|squats|splits|rdls); `sets` int NN 0..1000; `reps` int NN 0..100000; `effort` smallint 0..10.

### wake_log (replaces `wake`)
`id` = `wake:<date>` (CHECK `id = 'wake:' || wake_date`), `wake_date` date NN, `wake_time` time NN. One row per day per user.

### settings (replaces `meta` / id 'settings')
One row per user: `id` text CHECK `= 'settings'` (so PK `(user_id, id)` allows exactly one row); `theme` NN (dark|light); `skin` <=64; `wake_time` time NN;
`weekend_wake` time; `display_name` NN <=200 (the app's `name`); `settled_through` date (the app keeps it inside settings).

### preferences (replaces `kv`)
`key` ledger_id NN (PK `(user_id, key)`, this is the item id), `value` ledger_longtext NN. This is the synced key/value area (gym plan, mobility ticks, `crs:*` keys...).
The values are opaque strings (usually JSON written by feature code), so they stay text on purpose: this is the one genuinely free-form payload. Promote any key to its own table later if it earns it.

### Kept and internal
`record_backups` (unchanged). `record_tombstone_floor` (reused). `_sync_registry` (collection -> table/functions map; clients cannot read it).
`migration_skipped` (rows the migration could not map; should stay empty).

Is jsonb used anywhere? Only in `record_backups.payload` (a snapshot is one document) and inside the functions' request/response. No user-data table has a jsonb column.

## 5. How sync keeps working

**Push.** `push_records(p_items jsonb, p_device_id text)` keeps its exact request and response. It still takes the per-user advisory lock, runs every
item in its own sub-transaction, and compares `base_version` with the row's `version`. The only new step: the collection name is looked up in
`_sync_registry` and the item is handed to the table's own `_apply_<table>(user, id, json, device)` function, which (1) checks every field's JSON type
and the data id, (2) does `INSERT ... ON CONFLICT DO UPDATE` (the trigger bumps version and seq), (3) replaces the child rows. Status codes:
`ok` with the canonical row, `conflict` with the current row, `gone` (base > 0 but no row), `rejected` with a reason (a bad type, a CHECK violation,
unknown collection, id mismatch). A rejected item rolls back its own writes, including its child rows, and never the rest of the batch.
Difference to flag: a *tombstone for an item the server never had* (base 0 + deleted) now answers `gone` instead of storing an empty row; the engine already handles `gone`.

**Mapping both ways.** For each table there are two SQL functions: `_to_json_<table>(row)` builds the app's JSON object (NULL columns are omitted,
dates are `YYYY-MM-DD`, times `HH:MM`, timestamps `YYYY-MM-DDTHH:MM:SS.mmmZ`, children rebuilt as arrays in `position` order) and
`_apply_<table>(...)` goes JSON -> columns. In the draft's test every item shape round-tripped to a canonical-JSON-identical object
(the engine compares with `canon()`, so key order does not matter). Keys the schema does not know are not stored.

**Pull.** `pull_changes(p_after bigint default 0, p_limit int default 1000)` returns `{collection,id,data,deleted,version,seq,updated_at,device_id}`
ordered by `seq`: the same `RemoteRow` shape as today. Inside, each table contributes at most `p_limit` rows through its `(user_id, seq)` index, the
results are UNION ALLed, sorted by `seq` and cut to `p_limit`; JSON is built only for the rows that survive per table. Because one sequence feeds all
tables, "give me everything after cursor N" is still one number. It is a SECURITY DEFINER function that filters by `auth.uid()` itself (RLS-safe); clients still
cannot read other users' rows or call the internal helper. Cost: up to 19 index range scans per call; with a single user and ~100 rows this is negligible, and a
quiet poll (`seq > cursor`, nothing new) touches 19 index pages. A tombstone is returned with `data = {}` as today.

**Ordering guarantee.** Unchanged argument: the per-user advisory lock serialises one user's writers, so `seq` values commit in increasing order and a cursor never skips a late-committing row. The sequence is shared by all users and tables, so values have gaps; the cursor only needs ordering.

**Realtime.** Every parent table is in the `supabase_realtime` publication (child tables are not: they change in the same transaction as their parent). Realtime
events carry only the table's own columns (no rebuilt JSON, no children). So the client subscribes to the 19 tables with one channel and one binding each
(`filter: user_id=eq.<uid>`), and treats each event as a nudge: it calls `pull_changes(lastSeq)` (debounced) and emits the rows through the same `onRow`. The engine,
its merge rules and its version checks do not change. If realtime drops, polling every 20 s still works as today.

**Soft delete.** A delete sets `deleted = true` (trigger bumps version/seq, so every device learns about it), removes the child rows, and blanks the
free-text columns that can be blanked (journal body, notes, photo...). Other columns keep their values until purge (tombstone content is not private beyond 90 days; the old `{}` was more private: see risk R3).
Re-pushing the same id with the tombstone's version resurrects it. `purge_tombstones()` (weekly pg_cron, unchanged rules: older than 90 days and a later daily snapshot exists)
hard-deletes the row and writes its last version to `record_tombstone_floor`, so a re-created id continues the version line. Children follow their parent (removed at delete, `ON DELETE CASCADE` as a safety net).

## 6. Out-of-order arrival: why `habit_id`, `parent_id` and `habit_id` on blocks are NOT enforced foreign keys

Options considered: (a) enforced FK; (b) FK `DEFERRABLE INITIALLY DEFERRED` plus parent-first ordering inside a push; (c) logical reference with an index.
The engine pushes in batches of up to 500 from several devices, with no ordering between collections, and has no "try again later" status:
a log whose habit is not on the server yet would either abort the push at commit time (b) or be permanently `rejected` and quarantined (a). The purge job would
also be blocked by (or would orphan) logs of a long-deleted habit. And for old data, any orphan row would stop the migration. So (c): the relation is indexed and
documented, the app already hides logs of unknown habits, and orphans are harmless. A health query can list them (`select l.* from habit_logs l left join habits h on h.user_id = l.user_id and h.id = l.habit_id where h.id is null`).
Real FKs ARE used where the database owns the structure: `workout_sets`, `workout_queue_items`, `body_measurements`, `course_lectures` (children are written in the same transaction as the parent, so order cannot go wrong).
If you later want enforced FKs, the safe path is (b) together with a client change that pushes parents first (open question 2).

## 7. Existing rows, backups, restore

**Migration** (section 5 of the SQL; `public.records` is read, never changed): in one transaction, `records` is locked against writes and each collection is copied
with an explicit `INSERT ... SELECT` from the jsonb (casts such as `(data->>'xp')::numeric::integer`, `coalesce(data->>'name','')` for text that may be empty),
`ON CONFLICT DO NOTHING`, carrying over `version`, `seq`, `created_at`, `updated_at` and `device_id`, so every browser's stored cursor and base versions stay valid
(`sync_seq` is set above the highest existing seq). If one collection's statement fails because a legacy row breaks a rule, that collection is redone row by row through the same
`_apply_*` code and the rows that cannot be mapped go to `public.migration_skipped` instead of aborting. Re-running only adds missing rows; it never overwrites, so rehearse on a copy, then run once for real.
Legacy tombstones have no content to store; only their version floor is kept (risk R2).
**Verification:** `select * from public.verify_migration();` returns per collection: live rows in `records`, live rows in the typed tables, `missing`, `mismatched`
(the typed row rebuilt to JSON differs from the original jsonb) and `typed_extra`. Expected: `missing = 0` and `mismatched = 0` everywhere, and `select * from public.migration_skipped` empty.
With ~116 rows the whole check is a single screen. The file also contains a plain counts query (children included) as a comment.

**Backups.** `record_backups` and its payload `[{collection,id,data,version}]` are unchanged, so old snapshots stay restorable. `_snapshot_user` now builds the
payload from the typed tables through the same to_json functions. `restore_backup` first takes the `pre-restore` safety snapshot, tombstones live rows that are not in the snapshot,
and routes every snapshot row through `_write_item` (the same mapping as `push_records`); rows already identical are left alone (no version churn); snapshot rows that no longer satisfy the table rules are
skipped with a notice, not fatal. Every touched row gets a new version/seq, so all devices converge on their next pull. Nightly backup, 14-day retention and purge keep their schedules.
The in-app file backup (`ledger-backup` v2 JSON) is client-side and unchanged.

**Cutover** (section 7 of the SQL, applied together with the client release): strict trigger, new `push_records`, `pull_changes`, backup functions, and a trigger that makes `public.records`
read-only (it raises on any write, so a stale client gets a retryable error rather than silently writing to a dead table). Rollback before new writes: drop that trigger and re-apply 0006 + 0004.
Renaming or dropping `public.records` is left to the owner (open question 5).

## 8. RLS and privileges

RLS is enabled on every table; the only policy is select-own (`auth.uid() = user_id`). `anon` and `authenticated` have no INSERT/UPDATE/DELETE on anything and no access to the
sequence, registry, tombstone floor or internal functions. Clients can only `select` their own rows, call `push_records`, `pull_changes`, `take_backup`, `list_backups`, `restore_backup`.
The maintenance functions are for pg_cron / service_role. Every SECURITY DEFINER function pins `search_path` and filters by the caller's `auth.uid()` (the internal ones take a user id and are not granted to clients).
Realtime respects the select-own policy. Deleting a user in Supabase Auth cascades through every table.

## 9. What the client needs (not done here; `src/**` untouched)

1. `src/sync/remote.ts` `pull`: `client.rpc('pull_changes', { p_after: sinceSeq, p_limit: limit })` instead of `from('records').select(...)`.
2. `subscribe`: one `.on('postgres_changes', { schema: 'public', table: T, filter: 'user_id=eq.<uid>' }, nudge)` per parent table in a list of the 19 names; `nudge` does a debounced `pull_changes(lastSeq)` and calls `onRow` for each returned row.
3. The missing-migration error regex in `fail()` should also mention `pull_changes`.
4. Recommended with it: tighten `validate.ts` so counters (`xp`, `reps`, `sets`, `cost`, `pages`, `rating`, `effort`...) are integers (`Number.isInteger`), matching the columns; today a fractional value would be `rejected` by the server.
`push`, the merge rules, the store shape, backup files and every UI stay as they are. `tests/unit/pgliteRemote.ts` and `db.test.ts` read `records` directly and would need the same pull change.

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Mapping bug: JSON -> columns -> JSON differs from the app's object, so devices see phantom changes. | Round trip is verified per shape in the test and per real row by `verify_migration().mismatched`; add property tests for every collection before release. Absent vs null vs empty array is preserved on purpose (`has_queue`, `lectures_set`, `measurements_set`). |
| R2 | Legacy tombstones (deleted rows younger than 90 days) are not copied. A device that never synced the delete keeps the item; if it edits it, the push is `gone` and the item is re-created. | Check `legacy_tombstones` in the verification; if non-zero and a stale device exists, sync it before cutover. |
| R3 | Soft-deleted rows keep non-blankable columns for up to 90 days (before: `{}`). | Free-text columns are blanked on delete; shorten the 90 days if you care. |
| R4 | Stricter types than the client schema: whole numbers, `books.startedAt` as a date (an ISO timestamp would be cut to its date), timestamps normalised to UTC milliseconds, unknown JSON keys dropped. | Tighten `validate.ts` (section 9); the migration reports unmappable rows in `migration_skipped`. |
| R5 | A realtime event is only a nudge, so there is one extra round trip per change vs. today. | Debounce; polling remains the fallback; invisible at this data size. |
| R6 | Not tested on real Supabase (PGlite only). `lock table`, publication and pg_cron behave slightly differently there. | Rehearse on a Supabase branch or a restored copy, run `verify_migration()`, then cut over. Take "Back up now" first. |
| R7 | Old cached PWA bundles still pull from `records` (frozen) and would stop seeing new changes, while their pushes keep working through the new function. | Release client and database together; the frozen-table error and the update prompt make stale clients visible. |
| R8 | 19 index scans per pull instead of 1. | Fine for one user; if it ever matters, add a tiny `sync_changes(user_id, seq, collection, id)` journal table. |

## 11. Open questions for the owner

1. **Legacy tombstones:** is it fine that tombstones younger than 90 days are not carried over (R2), or should I add a generic `sync_tombstones` table to carry them exactly?
2. **Foreign keys:** keep `habit_id` / `parent_id` unenforced (recommended, section 6), or enforce them deferred and accept the client change "push parents first"?
3. **Integer tightening:** may the client (`validate.ts`) be changed to require whole numbers and real dates, accepting that odd old values are cut or reported by the migration?
4. **Body photos:** `photo` is a data URL up to 400 KB inside `body_log`. Keep it, or move photos to Supabase Storage (object path in the table)? Storage is better for size, but it is a separate feature.
5. **Old table:** after cutover, when do you want `public.records` renamed to `records_legacy` (keeps rollback) and finally dropped (suggestion: rename after 2 weeks of clean running, drop after 3 months)?
6. **Unknown fields:** the old table kept any extra JSON key; typed columns drop them. Acceptable (recommended), or add one `extra jsonb` column per table for forward compatibility?
