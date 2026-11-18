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
