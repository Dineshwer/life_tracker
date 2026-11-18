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
