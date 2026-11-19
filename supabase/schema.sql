-- Ledger: CURRENT FULL SCHEMA (identical to apply-all.sql below). Idempotent; upgrades an existing 0001 table in place.

-- ======== migrations/0001_init.sql ========
-- 0001: the original table (kept for history; 0002 upgrades it)
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  collection text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id)
);
create index if not exists records_user_updated on public.records (user_id, updated_at);
alter table public.records enable row level security;
drop policy if exists "own rows" on public.records;
create policy "own rows" on public.records for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ======== migrations/0002_records_upgrade.sql ========
-- 0002: upgrade public.records in place (no rows are lost) for versioned, cursor-based sync.
--   * new columns: version, seq, created_at, device_id          (existing rows are backfilled)
--   * seq / updated_at / version are SERVER-OWNED, set by a BEFORE trigger (clients can never choose them)
--   * CHECK constraints: collection allow-list, id length, data is an object, size limits
--   * writes are closed to clients (privileges revoked); they go through push_records() (0003)
--   * realtime publication
-- Idempotent: safe to run any number of times.

create sequence if not exists public.records_seq;

-- 1. columns -----------------------------------------------------------------------------------------------------
alter table public.records add column if not exists version   bigint not null default 1;
alter table public.records add column if not exists seq       bigint;
alter table public.records add column if not exists created_at timestamptz;
alter table public.records add column if not exists device_id text;

-- created_at: best available value for old rows is their last update time.
update public.records set created_at = updated_at where created_at is null;
alter table public.records alter column created_at set default now();
alter table public.records alter column created_at set not null;

-- 2. backfill seq in updated_at order (only rows that have none; the trigger below is created AFTER this) ----------
do $$
begin
  if exists (select 1 from public.records where seq is null) then
    with ordered as (
      select user_id, collection, id,
             row_number() over (order by updated_at, user_id, collection, id) as rn
      from public.records where seq is null
    ), base as (select coalesce(max(seq), 0) as b from public.records)
    update public.records r
       set seq = base.b + ordered.rn
      from ordered, base
     where r.user_id = ordered.user_id and r.collection = ordered.collection and r.id = ordered.id;
  end if;
  -- the sequence must continue after the highest seq in use
  if exists (select 1 from public.records) then
    perform setval('public.records_seq',
                   greatest((select max(seq) from public.records), (select last_value from public.records_seq)));
  end if;
end $$;

alter table public.records alter column seq drop default;   -- the trigger below is the only source of seq
alter table public.records alter column seq set not null;
alter sequence public.records_seq owned by public.records.seq;

-- Pull path: select * from records where seq > :cursor order by seq limit :n   (RLS adds user_id = auth.uid()).
create unique index if not exists records_user_seq on public.records (user_id, seq);
drop index if exists public.records_user_updated;   -- superseded by records_user_seq

-- 3. make existing rows satisfy the new constraints where we safely can ------------------------------------------
-- Tombstones carry no information; shrink any fat ones so the tombstone-size check can be validated.
update public.records set data = '{}'::jsonb where deleted and octet_length(data::text) > 1024;

-- 4. constraints. Added NOT VALID (enforced for every new/changed row immediately), then VALIDATEd against existing
--    rows. If some legacy row violates a rule we do NOT fail the migration: the constraint stays NOT VALID
--    (still enforcing new writes) and a NOTICE names it so the owner can inspect: see README "Constraint report".
do $$
declare
  c record;
begin
  -- the size limit was raised from 524288 to 600000 bytes: replace the older definition if present
  if exists (select 1 from pg_constraint where conrelid = 'public.records'::regclass and conname = 'records_data_size'
             and pg_get_constraintdef(oid) not like '%600000%') then
    alter table public.records drop constraint records_data_size;
  end if;
  for c in
    select * from (values
      ('records_collection_ok', $c$check (collection in ('habits','habitLogs','tasks','blocks','workouts','body','journal','rewards','xp','books','conversations','rejections','videos','channels','oneLogs','kv','wake','meta'))$c$),
      ('records_id_len_ok',     $c$check (char_length(id) between 1 and 200)$c$),
      ('records_data_object',   $c$check (jsonb_typeof(data) = 'object')$c$),
      ('records_data_size',     $c$check (octet_length(data::text) <= 600000)$c$),
      ('records_tombstone_small', $c$check (not deleted or octet_length(data::text) <= 1024)$c$),
      ('records_version_pos',   $c$check (version >= 1)$c$)
    ) as t(name, def)
  loop
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.records'::regclass and conname = c.name) then
      execute format('alter table public.records add constraint %I %s not valid', c.name, c.def);
    end if;
    begin
      execute format('alter table public.records validate constraint %I', c.name);
    exception when check_violation then
      raise notice 'constraint % left NOT VALID: legacy rows violate it (new writes are still checked)', c.name;
    end;
  end loop;
end $$;

-- 4b. version floor for purged tombstones. When purge_tombstones() deletes an old tombstone it records the item's last version
-- here; if the same id is ever created again, its first version is floor + 1, so a stale device still holding the old
-- base_version gets a 'conflict' instead of silently overwriting the new item.
create table if not exists public.record_tombstone_floor (
  user_id    uuid   not null references auth.users(id) on delete cascade,
  collection text   not null,
  id         text   not null,
  version    bigint not null,
  primary key (user_id, collection, id)
);
alter table public.record_tombstone_floor enable row level security;   -- no policies: clients cannot read or write it
revoke all on public.record_tombstone_floor from public, anon, authenticated;

-- 5. trigger: the server owns seq, updated_at and version ----------------------------------------------------------
-- Every insert/update gets a fresh seq (pulls use seq > cursor), the server clock, and version = old + 1.
-- This holds even for a manual UPDATE in the SQL editor, so versioning cannot be bypassed by accident.
create or replace function public.records_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.seq        := nextval('public.records_seq');
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.version    := 1 + coalesce((select f.version from public.record_tombstone_floor f
                                     where f.user_id = new.user_id and f.collection = new.collection and f.id = new.id), 0);
    new.created_at := coalesce(new.created_at, now());
  else
    new.version    := old.version + 1;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write before insert or update on public.records
  for each row execute function public.records_before_write();

-- 6. access control ----------------------------------------------------------------------------------------------
-- Design: clients may only SELECT (RLS: own rows). INSERT/UPDATE/DELETE privileges are revoked, so the only write path is
-- the SECURITY DEFINER function push_records(), which checks auth.uid() itself and applies optimistic concurrency.
alter table public.records enable row level security;
revoke all on public.records from public, anon, authenticated;
-- sequences: Supabase default privileges would otherwise hand USAGE (nextval) to clients
do $$
declare s record;
begin
  for s in select quote_ident(schemaname) || '.' || quote_ident(sequencename) as q from pg_sequences where schemaname = 'public' loop
    execute 'revoke all on sequence ' || s.q || ' from public, anon, authenticated';
  end loop;
end $$;
grant select on public.records to authenticated;

drop policy if exists "own rows" on public.records;          -- the old FOR ALL policy from 0001
drop policy if exists "records select own" on public.records;
create policy "records select own" on public.records for select to authenticated
  using (auth.uid() = user_id);

-- 7. realtime ------------------------------------------------------------------------------------------------------
-- Realtime only needs the new row (UPDATE/INSERT carry it in full; the primary key includes user_id for DELETE), so the
-- default replica identity is enough: no REPLICA IDENTITY FULL (it would double WAL for large rows).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- ======== migrations/0003_push_records.sql ========
-- 0003: the single write path. public.push_records(p_items jsonb, p_device_id text) -> jsonb
-- SECURITY DEFINER on purpose (see 0002 section 6): direct writes are revoked, the function enforces auth.uid() itself and
-- every statement below is filtered by user_id = v_uid, so it can only touch the caller's rows.
--
-- p_items: JSON array (max 500) of {collection, id, data, deleted, base_version}
-- returns: JSON array, same order: {collection, id, status, row?, reason?}
--   status 'ok'       written; row = new canonical row
--   status 'conflict' NOT written; row = server's current row (base_version != current version, incl. base 0 on existing)
--   status 'gone'     base_version > 0 but the item does not exist (tombstone purged); no row
--   status 'rejected' invalid item (reason says why); no row
--   row = {collection,id,data,deleted,version,seq,updated_at,device_id}
-- Tombstones (deleted = true) are stored with data = {} whatever the client sent.
--
-- Concurrency: a per-user advisory transaction lock serialises that user's writers, so seq values are committed in
-- increasing order (a pull cursor can never skip a row that commits late) and two simultaneous pushes of the same item
-- cannot both succeed; each row is also locked FOR UPDATE as a second line of defence.
-- Each item runs in its own sub-transaction (BEGIN ... EXCEPTION): one invalid item never aborts the batch. Non-validation
-- errors (not LD001/22xxx/23xxx) abort the whole call so the client retries.

create or replace function public._row_json(r public.records) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object('collection', r.collection, 'id', r.id, 'data', r.data, 'deleted', r.deleted,
                            'version', r.version, 'seq', r.seq, 'updated_at', r.updated_at, 'device_id', r.device_id)
$$;

create or replace function public.push_records(p_items jsonb, p_device_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_n       int;
  v_i       int;
  v_item    jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_coll    text;
  v_id      text;
  v_data    jsonb;
  v_deleted boolean;
  v_base    bigint;
  v_dev     text := left(p_device_id, 100);
  v_status  text;
  v_reason  text;
  r         public.records;
  v_row     jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n > 500 then
    raise exception 'batch too large: % items (max 500)', v_n using errcode = '54000';
  end if;
  if v_n = 0 then return '[]'::jsonb; end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger:records:' || v_uid::text, 0));

  for v_i in 0 .. v_n - 1 loop
    v_item := p_items -> v_i;
    v_coll := null; v_id := null; v_status := null; v_reason := null; v_row := null;
    begin
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'item is not an object' using errcode = 'LD001';
      end if;
      if jsonb_typeof(v_item -> 'collection') = 'string' then v_coll := v_item ->> 'collection'; end if;
      if jsonb_typeof(v_item -> 'id') = 'string' then v_id := v_item ->> 'id'; end if;

      -- validation (the CHECK constraints are the backstop; these give friendly reasons)
      if v_coll is null or v_coll not in ('habits','habitLogs','tasks','blocks','workouts','body','journal','rewards','xp',
                                          'books','conversations','rejections','videos','channels','oneLogs','kv','wake','meta') then
        raise exception 'unknown collection' using errcode = 'LD001';
      end if;
      if v_id is null or char_length(v_id) < 1 or char_length(v_id) > 200 or v_id ~ '[[:cntrl:]]' then
        raise exception 'invalid id (1..200 chars, no control characters)' using errcode = 'LD001';
      end if;
      if jsonb_typeof(v_item -> 'base_version') is distinct from 'number'
         or (v_item ->> 'base_version') !~ '^[0-9]+$' then
        raise exception 'base_version must be a non-negative integer' using errcode = 'LD001';
      end if;
      v_base := (v_item ->> 'base_version')::bigint;
      if not (v_item ? 'deleted') or jsonb_typeof(v_item -> 'deleted') = 'null' then
        v_deleted := false;                                   -- missing key defaults to false
      elsif jsonb_typeof(v_item -> 'deleted') = 'boolean' then
        v_deleted := (v_item ->> 'deleted')::boolean;
      else
        raise exception 'deleted must be a boolean' using errcode = 'LD001';
      end if;
      if v_deleted then
        v_data := '{}'::jsonb;
      else
        v_data := v_item -> 'data';
        if jsonb_typeof(v_data) is distinct from 'object' then
          raise exception 'data must be a JSON object' using errcode = 'LD001';
        end if;
        if octet_length(v_data::text) > 600000 then
          raise exception 'data too large (% bytes, max 600000)', octet_length(v_data::text) using errcode = 'LD001';
        end if;
      end if;

      -- optimistic concurrency
      select * into r from public.records
       where user_id = v_uid and collection = v_coll and id = v_id for update;

      if not found then
        if v_base = 0 then
          insert into public.records (user_id, collection, id, data, deleted, device_id)
          values (v_uid, v_coll, v_id, v_data, v_deleted, v_dev) returning * into r;
          v_status := 'ok'; v_row := public._row_json(r);
        else
          v_status := 'gone';
        end if;
      elsif r.version = v_base then
        update public.records
           set data = v_data, deleted = v_deleted, device_id = coalesce(v_dev, device_id)
         where user_id = v_uid and collection = v_coll and id = v_id returning * into r;
        v_status := 'ok'; v_row := public._row_json(r);
      else
        v_status := 'conflict'; v_row := public._row_json(r);
      end if;
    exception when others then
      -- Only validation-class errors mean "this item is invalid, do not retry": our own LD001, data exceptions (22xxx) and
      -- integrity/CHECK violations (23xxx). Anything else (serialization failure, lock timeout, disk, ...) is transient:
      -- re-raise so the whole call fails and the client retries with backoff.
      if sqlstate = 'LD001' or sqlstate like '22%' or sqlstate like '23%' then
        v_status := 'rejected';
        v_reason := sqlerrm;
        v_row := null;
      else
        raise;
      end if;
    end;

    v_out := v_out || jsonb_build_array(
      jsonb_build_object('collection', v_coll, 'id', v_id, 'status', v_status)
      || case when v_row is not null then jsonb_build_object('row', v_row) else '{}'::jsonb end
      || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end);
  end loop;
  return v_out;
end $$;

revoke all on function public._row_json(public.records) from public, anon, authenticated;
revoke all on function public.push_records(jsonb, text) from public, anon, authenticated;
grant execute on function public.push_records(jsonb, text) to authenticated;

-- ======== migrations/0004_backups.sql ========
-- 0004: server-side backups (daily snapshots, restore, retention, tombstone purge, pg_cron schedule).
-- Snapshots hold LIVE rows only (deleted = false). 'daily' = one per user per UTC day (upserted);
-- 'pre-restore' = safety copy taken automatically before every restore (many per day allowed). Both kept 14 days.
-- Deviation from the brief: surrogate id primary key + kind column instead of PK (user_id, taken_on), so safety copies never
-- collide with, or overwrite, each other or the daily snapshot.

create table if not exists public.record_backups (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  taken_on   date not null,
  kind       text not null default 'daily' check (kind in ('daily', 'pre-restore')),
  payload    jsonb not null,           -- [{collection,id,data,version}, ...]
  row_count  int  not null,
  created_at timestamptz not null default now()
);
create unique index if not exists record_backups_daily on public.record_backups (user_id, taken_on) where kind = 'daily';
create index if not exists record_backups_user_on on public.record_backups (user_id, taken_on);

alter table public.record_backups enable row level security;
revoke all on public.record_backups from public, anon, authenticated;
grant select on public.record_backups to authenticated;
drop policy if exists "backups select own" on public.record_backups;
create policy "backups select own" on public.record_backups for select to authenticated
  using (auth.uid() = user_id);

-- Internal: does an item satisfy the table's CHECK rules? (used by restore to skip legacy-invalid snapshot rows)
create or replace function public._item_valid(p_collection text, p_id text, p_data jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_collection in ('habits','habitLogs','tasks','blocks','workouts','body','journal','rewards','xp','books','conversations',
                          'rejections','videos','channels','oneLogs','kv','wake','meta')
     and char_length(p_id) between 1 and 200
     and jsonb_typeof(p_data) = 'object'
     and octet_length(p_data::text) <= 600000
$$;

-- Internal: snapshot one user's live rows. Not callable by clients.
create or replace function public._snapshot_user(p_uid uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payload jsonb;
  v_count   int;
  v_day     date := (now() at time zone 'utc')::date;
  v_old     int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('collection', collection, 'id', id, 'data', data, 'version', version)
                            order by collection, id), '[]'::jsonb),
         count(*)
    into v_payload, v_count
    from public.records where user_id = p_uid and not deleted;

  if p_kind = 'daily' then
    -- Guard: never replace today's good snapshot with a much smaller one (e.g. a buggy client mass-deleted, then snapshots).
    -- If the new snapshot has < 80% of the existing row_count, keep the existing one.
    select b.row_count into v_old from public.record_backups b
     where b.user_id = p_uid and b.taken_on = v_day and b.kind = 'daily';
    if found and v_count < v_old * 0.8 then
      return jsonb_build_object('taken_on', v_day, 'row_count', v_old, 'throttled', true);
    end if;
    insert into public.record_backups (user_id, taken_on, kind, payload, row_count, created_at)
    values (p_uid, v_day, 'daily', v_payload, v_count, clock_timestamp())
    on conflict (user_id, taken_on) where kind = 'daily'
    do update set payload = excluded.payload, row_count = excluded.row_count, created_at = excluded.created_at;
  else
    insert into public.record_backups (user_id, taken_on, kind, payload, row_count, created_at)
    values (p_uid, v_day, p_kind, v_payload, v_count, clock_timestamp());
  end if;
  return jsonb_build_object('taken_on', v_day, 'row_count', v_count);
end $$;

-- take_backup() -> {taken_on, row_count[, throttled]}. At most once per 10 minutes per user: inside the window it does not
-- snapshot again and returns the existing one with throttled = true (not an error).
create or replace function public.take_backup() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  b     public.record_backups;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger:records:' || v_uid::text, 0));
  -- retention without pg_cron: drop this user's expired snapshots whenever they take one
  delete from public.record_backups where user_id = v_uid and taken_on < (now() at time zone 'utc')::date - 14;
  select * into b from public.record_backups
   where user_id = v_uid and kind = 'daily' and created_at > now() - interval '10 minutes'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('taken_on', b.taken_on, 'row_count', b.row_count, 'throttled', true);
  end if;
  return public._snapshot_user(v_uid, 'daily');
end $$;

-- list_backups([include_safety]) -> rows, newest first. Daily snapshots only unless p_include_safety = true.
create or replace function public.list_backups(p_include_safety boolean default false)
returns table (taken_on date, row_count int, kind text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.taken_on, b.row_count, b.kind, b.created_at
    from public.record_backups b
   where b.user_id = auth.uid() and (p_include_safety or b.kind = 'daily')
   order by b.taken_on desc, b.created_at desc
$$;

-- restore_backup(date[, kind]) -> number of rows touched.
-- 1. a 'pre-restore' safety snapshot of the current live rows is taken first (itself restorable via p_kind = 'pre-restore');
-- 2. live rows missing from the snapshot become tombstones; snapshot rows are upserted (resurrecting tombstones);
-- every touched row gets a new seq and version+1 (via the trigger) so all devices converge on the next pull.
-- Rows whose live content already equals the snapshot are left untouched (no needless version churn / conflicts).
create or replace function public.restore_backup(p_date date, p_kind text default 'daily') returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_payload jsonb;
  n1        int;
  n2        int;
  v_skipped int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger:records:' || v_uid::text, 0));
  select payload into v_payload from public.record_backups
   where user_id = v_uid and taken_on = p_date and kind = p_kind
   order by created_at desc limit 1;
  if not found then
    raise exception 'no % backup for %', p_kind, p_date using errcode = 'P0002';
  end if;

  perform public._snapshot_user(v_uid, 'pre-restore');

  -- Snapshot entries that cannot be written back (legacy rows that violate the table constraints) are skipped, not fatal.
  select count(*) into v_skipped from jsonb_array_elements(v_payload) e
   where not public._item_valid(e ->> 'collection', e ->> 'id', e -> 'data');
  if v_skipped > 0 then
    raise notice 'restore_backup: skipped % legacy-invalid row(s) of the snapshot', v_skipped;
  end if;

  -- snapshot as a materialised set so the anti-join is a hash join (not one jsonb scan per row)
  with snap as materialized (
    select e ->> 'collection' as collection, e ->> 'id' as id from jsonb_array_elements(v_payload) e
  )
  update public.records r set deleted = true, data = '{}'::jsonb, device_id = 'restore'
   where r.user_id = v_uid and not r.deleted
     and public._item_valid(r.collection, r.id, '{}'::jsonb)   -- leave rows already violating constraints alone
     and not exists (select 1 from snap s where s.collection = r.collection and s.id = r.id);
  get diagnostics n1 = row_count;

  insert into public.records (user_id, collection, id, data, deleted, device_id)
  select v_uid, e ->> 'collection', e ->> 'id', e -> 'data', false, 'restore'
    from jsonb_array_elements(v_payload) e
   where public._item_valid(e ->> 'collection', e ->> 'id', e -> 'data')
  on conflict (user_id, collection, id) do update
     set data = excluded.data, deleted = false, device_id = 'restore'
   where public.records.deleted or public.records.data is distinct from excluded.data;
  get diagnostics n2 = row_count;

  return n1 + n2;
end $$;

-- run_nightly_backup() -> number of users backed up. For pg_cron / service role only. Also applies the 14-day retention.
create or replace function public.run_nightly_backup() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid;
  n int := 0;
begin
  for u in select distinct user_id from public.records where not deleted loop
    begin
      perform public._snapshot_user(u, 'daily');
      n := n + 1;
    exception when others then
      raise warning 'nightly backup failed for %: %', u, sqlerrm;
    end;
  end loop;
  delete from public.record_backups where taken_on < (now() at time zone 'utc')::date - 14;
  return n;
end $$;

-- purge_tombstones() -> rows deleted. Removes tombstones older than 90 days, but only once a daily snapshot taken AFTER the
-- deletion exists (so the item is already absent from a backup). A device that missed the deletion gets 'gone' on its next push.
create or replace function public.purge_tombstones() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  -- remember each purged item's last version (see record_tombstone_floor in 0002), then delete in the same statement
  with gone as (
    delete from public.records r
     where r.deleted and r.updated_at < now() - interval '90 days'
       and exists (select 1 from public.record_backups b
                    where b.user_id = r.user_id and b.kind = 'daily' and b.created_at > r.updated_at)
    returning r.user_id, r.collection, r.id, r.version
  ), floor as (
    insert into public.record_tombstone_floor (user_id, collection, id, version)
    select user_id, collection, id, version from gone
    on conflict (user_id, collection, id) do update set version = greatest(public.record_tombstone_floor.version, excluded.version)
    returning 1
  )
  select count(*) into n from gone;
  return n;
end $$;

-- privileges: clients get take/list/restore; the maintenance jobs are for cron / service_role only.
revoke all on function public._snapshot_user(uuid, text) from public, anon, authenticated;
revoke all on function public._item_valid(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.take_backup() from public, anon, authenticated;
revoke all on function public.list_backups(boolean) from public, anon, authenticated;
revoke all on function public.restore_backup(date, text) from public, anon, authenticated;
revoke all on function public.run_nightly_backup() from public, anon, authenticated;
revoke all on function public.purge_tombstones() from public, anon, authenticated;
grant execute on function public.take_backup() to authenticated;
grant execute on function public.list_backups(boolean) to authenticated;
grant execute on function public.restore_backup(date, text) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_nightly_backup() to service_role;
    grant execute on function public.purge_tombstones() to service_role;
  end if;
end $$;

-- pg_cron (optional: Dashboard -> Database -> Extensions -> pg_cron). If the extension is not enabled this block does nothing;
-- enable it and re-run this file (or apply-all.sql) to create the schedules. Re-running re-creates them (unschedule first).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ledger-nightly-backup') then
      perform cron.unschedule('ledger-nightly-backup');
    end if;
    if exists (select 1 from cron.job where jobname = 'ledger-purge-tombstones') then
      perform cron.unschedule('ledger-purge-tombstones');
    end if;
    perform cron.schedule('ledger-nightly-backup', '15 3 * * *', 'select public.run_nightly_backup()');
    perform cron.schedule('ledger-purge-tombstones', '45 3 * * 0', 'select public.purge_tombstones()');
  end if;
end $$;

-- ======== migrations/0006_courses_collection.sql ========
-- 0006: add the 'courses' collection to EVERY collection allow-list: the CHECK constraint, push_records, _item_valid.
-- Run this BEFORE deploying an app version that syncs 'courses' (the engine treats an unknown collection as a permanent 'rejected').
-- Idempotent; existing rows are untouched. The function bodies below are the 0003/0004 ones with only the list changed.

-- 1. CHECK constraint: replace the old definition (without 'courses'); NOT VALID first, then VALIDATE (tolerant, like 0002).
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.records'::regclass and conname = 'records_collection_ok'
             and pg_get_constraintdef(oid) not like '%''courses''%') then
    alter table public.records drop constraint records_collection_ok;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.records'::regclass and conname = 'records_collection_ok') then
    alter table public.records add constraint records_collection_ok
      check (collection in ('habits','habitLogs','tasks','blocks','workouts','body','journal','rewards','xp','books','conversations','rejections','videos','channels','oneLogs','kv','wake','meta','courses')) not valid;
  end if;
  begin
    alter table public.records validate constraint records_collection_ok;
  exception when check_violation then
    raise notice 'constraint records_collection_ok left NOT VALID: legacy rows violate it (new writes are still checked)';
  end;
end $$;

-- 2. push_records (from 0003)
create or replace function public.push_records(p_items jsonb, p_device_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_n       int;
  v_i       int;
  v_item    jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_coll    text;
  v_id      text;
  v_data    jsonb;
  v_deleted boolean;
  v_base    bigint;
  v_dev     text := left(p_device_id, 100);
  v_status  text;
  v_reason  text;
  r         public.records;
  v_row     jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n > 500 then
    raise exception 'batch too large: % items (max 500)', v_n using errcode = '54000';
  end if;
  if v_n = 0 then return '[]'::jsonb; end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger:records:' || v_uid::text, 0));

  for v_i in 0 .. v_n - 1 loop
    v_item := p_items -> v_i;
    v_coll := null; v_id := null; v_status := null; v_reason := null; v_row := null;
    begin
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'item is not an object' using errcode = 'LD001';
      end if;
      if jsonb_typeof(v_item -> 'collection') = 'string' then v_coll := v_item ->> 'collection'; end if;
      if jsonb_typeof(v_item -> 'id') = 'string' then v_id := v_item ->> 'id'; end if;

      -- validation (the CHECK constraints are the backstop; these give friendly reasons)
      if v_coll is null or v_coll not in ('habits','habitLogs','tasks','blocks','workouts','body','journal','rewards','xp',
                                          'books','conversations','rejections','videos','channels','oneLogs','kv','wake','meta','courses') then
        raise exception 'unknown collection' using errcode = 'LD001';
      end if;
      if v_id is null or char_length(v_id) < 1 or char_length(v_id) > 200 or v_id ~ '[[:cntrl:]]' then
        raise exception 'invalid id (1..200 chars, no control characters)' using errcode = 'LD001';
      end if;
      if jsonb_typeof(v_item -> 'base_version') is distinct from 'number'
         or (v_item ->> 'base_version') !~ '^[0-9]+$' then
        raise exception 'base_version must be a non-negative integer' using errcode = 'LD001';
      end if;
      v_base := (v_item ->> 'base_version')::bigint;
      if not (v_item ? 'deleted') or jsonb_typeof(v_item -> 'deleted') = 'null' then
        v_deleted := false;                                   -- missing key defaults to false
      elsif jsonb_typeof(v_item -> 'deleted') = 'boolean' then
        v_deleted := (v_item ->> 'deleted')::boolean;
      else
        raise exception 'deleted must be a boolean' using errcode = 'LD001';
      end if;
      if v_deleted then
        v_data := '{}'::jsonb;
      else
        v_data := v_item -> 'data';
        if jsonb_typeof(v_data) is distinct from 'object' then
          raise exception 'data must be a JSON object' using errcode = 'LD001';
        end if;
        if octet_length(v_data::text) > 600000 then
          raise exception 'data too large (% bytes, max 600000)', octet_length(v_data::text) using errcode = 'LD001';
        end if;
      end if;

      -- optimistic concurrency
      select * into r from public.records
       where user_id = v_uid and collection = v_coll and id = v_id for update;

      if not found then
        if v_base = 0 then
          insert into public.records (user_id, collection, id, data, deleted, device_id)
          values (v_uid, v_coll, v_id, v_data, v_deleted, v_dev) returning * into r;
          v_status := 'ok'; v_row := public._row_json(r);
        else
          v_status := 'gone';
        end if;
      elsif r.version = v_base then
        update public.records
           set data = v_data, deleted = v_deleted, device_id = coalesce(v_dev, device_id)
         where user_id = v_uid and collection = v_coll and id = v_id returning * into r;
        v_status := 'ok'; v_row := public._row_json(r);
      else
        v_status := 'conflict'; v_row := public._row_json(r);
      end if;
    exception when others then
      -- Only validation-class errors mean "this item is invalid, do not retry": our own LD001, data exceptions (22xxx) and
      -- integrity/CHECK violations (23xxx). Anything else (serialization failure, lock timeout, disk, ...) is transient:
      -- re-raise so the whole call fails and the client retries with backoff.
      if sqlstate = 'LD001' or sqlstate like '22%' or sqlstate like '23%' then
        v_status := 'rejected';
        v_reason := sqlerrm;
        v_row := null;
      else
        raise;
      end if;
    end;

    v_out := v_out || jsonb_build_array(
      jsonb_build_object('collection', v_coll, 'id', v_id, 'status', v_status)
      || case when v_row is not null then jsonb_build_object('row', v_row) else '{}'::jsonb end
      || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end);
  end loop;
  return v_out;
end $$;

revoke all on function public.push_records(jsonb, text) from public, anon, authenticated;
grant execute on function public.push_records(jsonb, text) to authenticated;

-- 3. _item_valid (from 0004; used by restore_backup)
create or replace function public._item_valid(p_collection text, p_id text, p_data jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_collection in ('habits','habitLogs','tasks','blocks','workouts','body','journal','rewards','xp','books','conversations',
                          'rejections','videos','channels','oneLogs','kv','wake','meta','courses')
     and char_length(p_id) between 1 and 200
     and jsonb_typeof(p_data) = 'object'
     and octet_length(p_data::text) <= 600000
$$;

revoke all on function public._item_valid(text, text, jsonb) from public, anon, authenticated;

-- ======== migrations/0007_report.sql ========
-- 0005: read-only post-migration report. The SQL editor shows the result of the LAST statement, so apply-all.sql ends with this.
-- Look for: every constraint 'validated' (otherwise legacy rows violate it, see README), rows == distinct seq, min version >= 1.
select 'constraint' as check, c.conname::text as item,
       case when c.convalidated then 'validated' else 'NOT VALID: legacy rows violate it (new writes still checked)' end as result
  from pg_constraint c where c.conrelid = 'public.records'::regclass and c.contype = 'c'
union all
select 'records', 'rows / distinct seq / min version',
       count(*) || ' / ' || count(distinct seq) || ' / ' || coalesce(min(version)::text, '-') from public.records
union all
select 'client privileges', 'authenticated can INSERT into records (must be false)',
       has_table_privilege('authenticated', 'public.records', 'INSERT')::text
union all
select 'backups', 'rows in record_backups', count(*)::text from public.record_backups
order by 1, 2;
