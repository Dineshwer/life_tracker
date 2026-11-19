-- 0008 (DRAFT, not in migrations/): typed relational tables replacing the generic public.records (collection text + data jsonb).
-- DESIGN FOR OWNER REVIEW: read docs/SCHEMA.md first. NOT applied anywhere. Not picked up by the bundler (it lives in supabase/drafts/).
-- Deployment unit: applied ONCE, together with the matching client release (src/sync/remote.ts: pull -> pull_changes, realtime nudges).
-- Sections:  1 domains/sequence/registry   2 helpers   3 tables (+children, indexes, RLS, triggers, realtime)
--            4 per-collection JSON mapping (to_json / apply)   5 migration copy from public.records (public.records stays untouched)
--            6 verification   7 CUTOVER (new push_records / pull_changes / backups; freezes public.records)
-- Everything before section 7 is additive: the running app keeps using public.records until section 7 commits.
-- Run it as one transaction on a copy / Supabase branch first (rehearsal), then once in production right before releasing the client.

-- ===================================================================================================================
-- 1. DOMAINS, SEQUENCE, REGISTRY
-- ===================================================================================================================
-- Domains = reusable typed columns with the exact rules of src/lib/validate.ts. Changing a rule later = ALTER DOMAIN once.
do $$ begin
  create domain public.ledger_id       as text check (char_length(value) between 1 and 200 and value !~ '[[:cntrl:]]');
  exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_date     as date check (value between date '1970-01-01' and date '2200-12-31'); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_stat     as text check (value in ('body','mind','skill','discipline')); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_unit     as text check (value in ('kg','bw','sec')); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_score    as smallint check (value between 1 and 5); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_text     as text check (char_length(value) <= 2000); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_longtext as text check (char_length(value) <= 200000); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_topic    as text check (value in ('mind','comm','biz','tech','psy','art','tamil','econ','fin','sci')); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_fin_sub  as text check (value in ('stocks','investing','saving')); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_list     as text check (value in ('mine','suggested','hidden')); exception when duplicate_object then null; end $$;
do $$ begin create domain public.ledger_origin   as text check (value in ('pick','suggest','custom')); exception when duplicate_object then null; end $$;

-- ONE sequence for every table: a single pull cursor orders the changes of ALL tables. Continues after the highest seq of public.records
-- so every cursor already stored in a browser stays valid.
create sequence if not exists public.sync_seq;
select setval('public.sync_seq', greatest(coalesce((select max(seq) from public.records), 0), (select last_value from public.records_seq), (select last_value from public.sync_seq)));
revoke all on sequence public.sync_seq from public, anon, authenticated;

-- Registry: which table/functions serve which app collection. Read only by the SECURITY DEFINER functions (no client access).
create table if not exists public._sync_registry (
  collection  text primary key,      -- the app's collection name (src/sync/types.ts COLLECTIONS)
  table_name  text not null unique,
  key_col     text not null,         -- column holding the item id used by the app ('id', or 'key' for preferences)
  to_json_fn  text not null,         -- row -> the app's JSON object
  apply_fn    text not null,         -- JSON object -> row (+ child rows)
  scrub       text,                  -- extra SET clause applied when an item is soft-deleted (drops free text early)
  child_tables text[], child_fk text -- child tables cleared when the parent is soft-deleted
);
alter table public._sync_registry enable row level security;
revoke all on public._sync_registry from public, anon, authenticated;

-- Reuses public.record_tombstone_floor from 0002 (user_id, collection, id, version): version floor for purged tombstones.

-- Items the migration could not map (inspect after section 5; empty = nothing lost).
create table if not exists public.migration_skipped (
  user_id uuid, collection text, id text, reason text, at timestamptz default now()
);
alter table public.migration_skipped enable row level security;
revoke all on public.migration_skipped from public, anon, authenticated;

-- ===================================================================================================================
-- 2. HELPERS
-- ===================================================================================================================
-- Strict JSON readers. A wrong type raises errcode LD001 -> push_records answers status 'rejected' with the message.
create or replace function public._jtext(d jsonb, k text, req boolean default true) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := jsonb_typeof(d -> k);
begin
  if t is null or t = 'null' then
    if req then raise exception 'field %: required', k using errcode = 'LD001'; end if;
    return null;
  end if;
  if t <> 'string' then raise exception 'field %: expected a string', k using errcode = 'LD001'; end if;
  return d ->> k;
end $$;
create or replace function public._jnum(d jsonb, k text, req boolean default true) returns numeric
language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := jsonb_typeof(d -> k);
begin
  if t is null or t = 'null' then
    if req then raise exception 'field %: required', k using errcode = 'LD001'; end if;
    return null;
  end if;
  if t <> 'number' then raise exception 'field %: expected a number', k using errcode = 'LD001'; end if;
  return (d ->> k)::numeric;
end $$;
-- integers: the client schema accepts any finite number; the typed columns are whole numbers (see docs/SCHEMA.md "tightening")
create or replace function public._jint(d jsonb, k text, req boolean default true) returns integer
language plpgsql immutable set search_path = public, pg_temp as $$
declare n numeric := public._jnum(d, k, req);
begin
  if n is null then return null; end if;
  if n <> trunc(n) then raise exception 'field %: expected a whole number', k using errcode = 'LD001'; end if;
  return n::integer;
end $$;
create or replace function public._jbool(d jsonb, k text, req boolean default true) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := jsonb_typeof(d -> k);
begin
  if t is null or t = 'null' then
    if req then raise exception 'field %: required', k using errcode = 'LD001'; end if;
    return null;
  end if;
  if t <> 'boolean' then raise exception 'field %: expected true/false', k using errcode = 'LD001'; end if;
  return (d ->> k)::boolean;
end $$;
create or replace function public._jdate(d jsonb, k text, req boolean default true) returns date
language plpgsql immutable set search_path = public, pg_temp as $$
declare s text := public._jtext(d, k, req);
begin
  if s is null then return null; end if;
  if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'field %: expected YYYY-MM-DD', k using errcode = 'LD001'; end if;
  return s::date;                       -- 2026-02-30 raises 22008 -> rejected
end $$;
create or replace function public._jtime(d jsonb, k text, req boolean default true) returns time
language plpgsql immutable set search_path = public, pg_temp as $$
declare s text := public._jtext(d, k, req);
begin
  if s is null then return null; end if;
  if s !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'field %: expected HH:MM', k using errcode = 'LD001'; end if;
  return s::time;
end $$;
create or replace function public._jts(d jsonb, k text, req boolean default true) returns timestamptz
language plpgsql stable set search_path = public, pg_temp set timezone = 'UTC' as $$
declare s text := public._jtext(d, k, req);
begin
  if s is null then return null; end if;
  if char_length(s) > 40 then raise exception 'field %: timestamp too long', k using errcode = 'LD001'; end if;
  return s::timestamptz;                -- unparsable text raises 22007/22008 -> rejected
end $$;
create or replace function public._jarr(d jsonb, k text, req boolean default true) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := jsonb_typeof(d -> k);
begin
  if t is null or t = 'null' then
    if req then raise exception 'field %: required', k using errcode = 'LD001'; end if;
    return null;
  end if;
  if t <> 'array' then raise exception 'field %: expected a list', k using errcode = 'LD001'; end if;
  return d -> k;
end $$;
create or replace function public._jobj(d jsonb, k text, req boolean default true) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := jsonb_typeof(d -> k);
begin
  if t is null or t = 'null' then
    if req then raise exception 'field %: required', k using errcode = 'LD001'; end if;
    return null;
  end if;
  if t <> 'object' then raise exception 'field %: expected an object', k using errcode = 'LD001'; end if;
  return d -> k;
end $$;
-- the JSON must describe the item it is pushed as
create or replace function public._jid(d jsonb, p_id text) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(d) is distinct from 'object' then raise exception 'data must be a JSON object' using errcode = 'LD001'; end if;
  if d ->> 'id' is distinct from p_id then raise exception 'data.id does not match the item id' using errcode = 'LD001'; end if;
end $$;
-- JSON array of whole numbers -> smallint[] ; JSON array of strings -> text[]
create or replace function public._jintarr(d jsonb, k text) returns smallint[]
language plpgsql immutable set search_path = public, pg_temp as $$
declare a jsonb := public._jarr(d, k); e jsonb; r smallint[] := '{}';
begin
  for e in select * from jsonb_array_elements(a) loop
    if jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric) then raise exception 'field %: expected whole numbers', k using errcode = 'LD001'; end if;
    r := r || (e #>> '{}')::smallint;
  end loop;
  return r;
end $$;
create or replace function public._jtextarr(d jsonb, k text) returns text[]
language plpgsql immutable set search_path = public, pg_temp as $$
declare a jsonb := public._jarr(d, k); e jsonb; r text[] := '{}';
begin
  for e in select * from jsonb_array_elements(a) loop
    if jsonb_typeof(e) <> 'string' then raise exception 'field %: expected strings', k using errcode = 'LD001'; end if;
    r := r || (e #>> '{}');
  end loop;
  return r;
end $$;
-- JSON output formats identical to what the app writes
create or replace function public._d(x date) returns text language sql immutable as $$ select to_char(x, 'YYYY-MM-DD') $$;
create or replace function public._t(x time) returns text language sql immutable as $$ select to_char(x, 'HH24:MI') $$;
create or replace function public._ts(x timestamptz) returns text language sql immutable set timezone = 'UTC' as $$
  select to_char(x at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
create or replace function public._tags_ok(t text[]) returns boolean language sql immutable as $$
  select coalesce(cardinality(t) <= 50 and not exists (select 1 from unnest(t) x where x is null or char_length(x) > 100), false) $$;
-- tolerant casts for the migration only
create or replace function public._try_ts(x text) returns timestamptz language plpgsql stable set timezone = 'UTC' as $$
begin return x::timestamptz; exception when others then return null; end $$;
create or replace function public._try_date(x text) returns date language plpgsql immutable as $$
begin return left(x, 10)::date; exception when others then return null; end $$;

-- Sync trigger (BEFORE INSERT/UPDATE on every user-data table): the server owns seq, version and updated_at. Arguments: collection, key column.
-- The 'ledger.migrating' branch exists ONLY so section 5 can copy version/seq/timestamps from public.records unchanged; section 7 replaces
-- this function with the strict version.
create or replace function public._sync_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('ledger.migrating', true) = '1' then
    new.seq := coalesce(new.seq, nextval('public.sync_seq'));
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  new.seq        := nextval('public.sync_seq');
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.version    := 1 + coalesce((select f.version from public.record_tombstone_floor f
                                     where f.user_id = new.user_id and f.collection = tg_argv[0] and f.id = to_jsonb(new) ->> tg_argv[1]), 0);
    new.created_at := coalesce(new.created_at, now());
  else
    new.version    := old.version + 1;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- ===================================================================================================================
-- 3. TABLES
-- Every user-data table: user_id -> auth.users (cascade), primary key (user_id, <id>), the six sync columns, RLS select-own,
-- clients get SELECT only. Writes happen exclusively through the SECURITY DEFINER functions of sections 4 and 7.
-- ===================================================================================================================

create table if not exists public.habits (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  name text not null check (char_length(name) between 1 and 200),
  stat ledger_stat not null,
  xp integer not null check (xp between 0 and 100000),
  minimum text check (char_length(minimum) <= 2000),
  archived boolean,
  cadence_type text not null check (cadence_type in ('daily','weekly','days')),
  cadence_per_week smallint check (cadence_per_week between 1 and 7),
  cadence_days smallint[] check (cardinality(cadence_days) <= 7 and cadence_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  unit_label text check (char_length(unit_label) <= 100),
  unit_target numeric check (unit_target between 0 and 1000000),
  constraint habits_cadence_shape check (
       (cadence_type = 'daily'  and cadence_per_week is null and cadence_days is null)
    or (cadence_type = 'weekly' and cadence_per_week is not null and cadence_days is null)
    or (cadence_type = 'days'   and cadence_days is not null and cadence_per_week is null)),
  constraint habits_unit_pair check ((unit_label is null) = (unit_target is null)),
  version    bigint      not null default 1 constraint habits_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.habit_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  habit_id ledger_id not null,          -- logical reference to habits.id (no enforced FK: see docs/SCHEMA.md, out-of-order sync)
  log_date ledger_date not null,
  level text not null check (level in ('full','min')),
  amount numeric check (amount between 0 and 10000000),
  note ledger_longtext,
  version    bigint      not null default 1 constraint habit_logs_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.tasks (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  title text not null check (char_length(title) between 1 and 1000),
  done boolean not null,
  done_at timestamptz,
  task_date ledger_date,
  context text not null check (context in ('job','agency','personal','learning')),
  tags text[] not null default '{}' check (public._tags_ok(tags)),
  parent_id ledger_id,                  -- subtask -> parent task (self reference, not enforced, see docs)
  recurrence_every text check (recurrence_every in ('day','week','month')),
  recurrence_interval smallint check (recurrence_interval between 1 and 366),
  horizon text check (horizon in ('today','short','long')),
  effort smallint not null check (effort between 1 and 3),
  stat ledger_stat not null,
  constraint tasks_recurrence_pair check ((recurrence_every is null) = (recurrence_interval is null)),
  version    bigint      not null default 1 constraint tasks_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.routine_blocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  title text not null check (char_length(title) between 1 and 200),
  start_time time not null check (extract(second from start_time) = 0),
  end_time time not null check (extract(second from end_time) = 0),
  day_kind text not null check (day_kind in ('weekday','weekend','all')),
  kind text not null check (kind in ('fixed','agency','habit','focus','free')),
  fixed boolean,
  habit_id ledger_id,
  version    bigint      not null default 1 constraint routine_blocks_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.workouts (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  workout_date ledger_date not null,
  name ledger_text not null check (char_length(name) <= 200),
  notes ledger_longtext,
  plan_id text check (char_length(plan_id) <= 200),
  -- has_queue: the app distinguishes "no queue" from an empty queue
  has_queue boolean not null default false,
  version    bigint      not null default 1 constraint workouts_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.workout_sets (
  user_id    uuid not null,
  workout_id ledger_id not null,
  position   smallint not null check (position between 0 and 999),
  id         ledger_id not null,
  exercise   text not null check (char_length(exercise) <= 200),
  reps       integer not null check (reps between 0 and 100000),
  weight     numeric not null check (weight between 0 and 100000),
  unit       ledger_unit not null,
  note       ledger_text,
  primary key (user_id, workout_id, position),
  foreign key (user_id, workout_id) references public.workouts (user_id, id) on delete cascade
);
create table if not exists public.workout_queue_items (
  user_id    uuid not null,
  workout_id ledger_id not null,
  position   smallint not null check (position between 0 and 499),
  id         ledger_id not null,
  name       text not null check (char_length(name) <= 200),
  sets       integer not null check (sets between 0 and 1000),
  reps       integer not null check (reps between 0 and 100000),
  unit       ledger_unit not null,
  demo       ledger_text,
  instructions ledger_longtext,
  note       ledger_longtext,
  skipped    boolean,
  primary key (user_id, workout_id, position),
  foreign key (user_id, workout_id) references public.workouts (user_id, id) on delete cascade
);

create table if not exists public.body_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  entry_date ledger_date not null,
  weight_kg numeric check (weight_kg between 1 and 1000),
  measurements_set boolean not null default false,  -- the app distinguishes "no measurements" from an empty map
  photo text check (char_length(photo) <= 400000),
  version    bigint      not null default 1 constraint body_log_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.body_measurements (
  user_id  uuid not null,
  entry_id ledger_id not null,
  name     text not null check (char_length(name) between 1 and 200),
  value    numeric not null check (value between 0 and 10000),
  primary key (user_id, entry_id, name),
  foreign key (user_id, entry_id) references public.body_log (user_id, id) on delete cascade
);

create table if not exists public.journal_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  entry_date ledger_date not null,
  body ledger_longtext not null,
  kind text not null check (kind in ('daily','weekly')),
  mood ledger_score,
  energy ledger_score,
  version    bigint      not null default 1 constraint journal_entries_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.rewards (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  title text not null check (char_length(title) between 1 and 300),
  cost integer not null check (cost between 0 and 10000000),
  claimed_at timestamptz,
  version    bigint      not null default 1 constraint rewards_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.xp_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  event_date ledger_date not null,
  stat ledger_stat not null,
  amount integer not null check (amount between -100000 and 100000),
  reason text not null check (char_length(reason) <= 500),
  ref text check (char_length(ref) <= 200),
  version    bigint      not null default 1 constraint xp_events_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.books (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  title text not null check (char_length(title) between 1 and 500),
  author text check (char_length(author) <= 300),
  status text not null check (status in ('reading','done','queued')),
  kind text check (kind in ('self','story')),
  pages integer check (pages between 0 and 100000),
  page integer check (page between 0 and 100000),
  started_on date,
  finished_on date,
  rating smallint check (rating between 0 and 5),
  version    bigint      not null default 1 constraint books_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.conversations (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  convo_date ledger_date not null,
  who text not null check (char_length(who) <= 300),
  note ledger_longtext,
  version    bigint      not null default 1 constraint conversations_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.rejections (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  rejection_date ledger_date not null,
  logged_at timestamptz not null,
  what ledger_longtext not null,
  who text check (char_length(who) <= 500),
  note ledger_longtext,
  version    bigint      not null default 1 constraint rejections_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.saved_videos (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  yt_id text not null check (char_length(yt_id) between 1 and 64),
  title text not null check (char_length(title) <= 500),
  tag text not null check (tag in ('learn','fun')),
  added_at timestamptz not null,
  watched_at timestamptz,
  version    bigint      not null default 1 constraint saved_videos_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.channels (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  handle text not null check (char_length(handle) between 1 and 200),
  cid text check (char_length(cid) <= 100),
  topic text not null check (topic in ('mind','comm','biz','tech','psy','art','tamil','econ','fin','sci','sec','per','code')),
  sub ledger_fin_sub,
  name text check (char_length(name) <= 200),
  about text check (char_length(about) <= 500),
  list_name ledger_list,
  origin ledger_origin,
  version    bigint      not null default 1 constraint channels_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.courses (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  kind text not null check (kind in ('playlist','link')),
  title text not null check (char_length(title) between 1 and 300),
  author text check (char_length(author) <= 200),
  topic ledger_topic not null,
  sub ledger_fin_sub,
  list_name ledger_list not null,
  origin ledger_origin not null,
  url text check (char_length(url) <= 500),
  lecture_count integer check (lecture_count between 0 and 100000),
  about text check (char_length(about) <= 500),
  lectures_set boolean not null default false,   -- the app distinguishes "lecture list never fetched" from an empty list
  lectures_fetched_at timestamptz,
  version    bigint      not null default 1 constraint courses_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.course_lectures (
  user_id    uuid not null,
  course_id  ledger_id not null,
  position   smallint not null check (position between 0 and 499),   -- at most 500 lectures, as in validate.ts
  yt_id      text not null check (char_length(yt_id) between 1 and 64),
  title      text not null check (char_length(title) <= 300),
  duration_s integer not null check (duration_s between 0 and 10000000),
  primary key (user_id, course_id, position),
  foreign key (user_id, course_id) references public.courses (user_id, id) on delete cascade
);

create table if not exists public.one_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,
  log_date ledger_date not null,
  exercise text not null check (exercise in ('pullups','dips','pushups','rows','pikes','squats','splits','rdls')),
  sets integer not null check (sets between 0 and 1000),
  reps integer not null check (reps between 0 and 100000),
  effort smallint check (effort between 0 and 10),
  version    bigint      not null default 1 constraint one_logs_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.wake_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  id ledger_id not null,                  -- 'wake:<date>' exactly like the app's item id
  wake_date ledger_date not null,
  wake_time time not null check (extract(second from wake_time) = 0),
  constraint wake_log_id_matches check (id = 'wake:' || to_char(wake_date, 'YYYY-MM-DD')),
  version    bigint      not null default 1 constraint wake_log_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null default 'settings' check (id = 'settings'),   -- exactly one row per user
  theme text not null check (theme in ('dark','light')),
  skin text check (char_length(skin) <= 64),
  wake_time time not null check (extract(second from wake_time) = 0),
  weekend_wake time check (extract(second from weekend_wake) = 0),
  display_name text not null check (char_length(display_name) <= 200),
  settled_through ledger_date,
  version    bigint      not null default 1 constraint settings_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  key ledger_id not null,
  value ledger_longtext not null,
  version    bigint      not null default 1 constraint preferences_version_pos check (version >= 1),
  seq        bigint      not null,
  deleted    boolean     not null default false,
  device_id  text        check (char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- indexes, triggers, RLS, grants, realtime (generated per table, identical rules)
create unique index if not exists habits_user_seq on public.habits (user_id, seq);   -- the pull path
drop trigger if exists habits_sync on public.habits;
create trigger habits_sync before insert or update on public.habits
  for each row execute function public._sync_before_write('habits', 'id');
create unique index if not exists habit_logs_user_seq on public.habit_logs (user_id, seq);   -- the pull path
create index if not exists habit_logs_ix1 on public.habit_logs (user_id, habit_id, log_date);
create index if not exists habit_logs_ix2 on public.habit_logs (user_id, log_date);
drop trigger if exists habit_logs_sync on public.habit_logs;
create trigger habit_logs_sync before insert or update on public.habit_logs
  for each row execute function public._sync_before_write('habitLogs', 'id');
create unique index if not exists tasks_user_seq on public.tasks (user_id, seq);   -- the pull path
create index if not exists tasks_ix1 on public.tasks (user_id, task_date);
create index if not exists tasks_ix2 on public.tasks (user_id, parent_id) where parent_id is not null;
create index if not exists tasks_ix3 on public.tasks (user_id, task_date) where not done and not deleted;
create index if not exists tasks_ix4 on public.tasks using gin (tags);
drop trigger if exists tasks_sync on public.tasks;
create trigger tasks_sync before insert or update on public.tasks
  for each row execute function public._sync_before_write('tasks', 'id');
create unique index if not exists routine_blocks_user_seq on public.routine_blocks (user_id, seq);   -- the pull path
create index if not exists routine_blocks_ix1 on public.routine_blocks (user_id, habit_id) where habit_id is not null;
drop trigger if exists routine_blocks_sync on public.routine_blocks;
create trigger routine_blocks_sync before insert or update on public.routine_blocks
  for each row execute function public._sync_before_write('blocks', 'id');
create unique index if not exists workouts_user_seq on public.workouts (user_id, seq);   -- the pull path
create index if not exists workouts_ix1 on public.workouts (user_id, workout_date);
drop trigger if exists workouts_sync on public.workouts;
create trigger workouts_sync before insert or update on public.workouts
  for each row execute function public._sync_before_write('workouts', 'id');
create unique index if not exists body_log_user_seq on public.body_log (user_id, seq);   -- the pull path
create index if not exists body_log_ix1 on public.body_log (user_id, entry_date);
drop trigger if exists body_log_sync on public.body_log;
create trigger body_log_sync before insert or update on public.body_log
  for each row execute function public._sync_before_write('body', 'id');
create unique index if not exists journal_entries_user_seq on public.journal_entries (user_id, seq);   -- the pull path
create index if not exists journal_entries_ix1 on public.journal_entries (user_id, entry_date);
drop trigger if exists journal_entries_sync on public.journal_entries;
create trigger journal_entries_sync before insert or update on public.journal_entries
  for each row execute function public._sync_before_write('journal', 'id');
create unique index if not exists rewards_user_seq on public.rewards (user_id, seq);   -- the pull path
drop trigger if exists rewards_sync on public.rewards;
create trigger rewards_sync before insert or update on public.rewards
  for each row execute function public._sync_before_write('rewards', 'id');
create unique index if not exists xp_events_user_seq on public.xp_events (user_id, seq);   -- the pull path
create index if not exists xp_events_ix1 on public.xp_events (user_id, event_date);
create index if not exists xp_events_ix2 on public.xp_events (user_id, ref) where ref is not null;
drop trigger if exists xp_events_sync on public.xp_events;
create trigger xp_events_sync before insert or update on public.xp_events
  for each row execute function public._sync_before_write('xp', 'id');
create unique index if not exists books_user_seq on public.books (user_id, seq);   -- the pull path
create index if not exists books_ix1 on public.books (user_id, status);
drop trigger if exists books_sync on public.books;
create trigger books_sync before insert or update on public.books
  for each row execute function public._sync_before_write('books', 'id');
create unique index if not exists conversations_user_seq on public.conversations (user_id, seq);   -- the pull path
create index if not exists conversations_ix1 on public.conversations (user_id, convo_date);
drop trigger if exists conversations_sync on public.conversations;
create trigger conversations_sync before insert or update on public.conversations
  for each row execute function public._sync_before_write('conversations', 'id');
create unique index if not exists rejections_user_seq on public.rejections (user_id, seq);   -- the pull path
create index if not exists rejections_ix1 on public.rejections (user_id, rejection_date);
drop trigger if exists rejections_sync on public.rejections;
create trigger rejections_sync before insert or update on public.rejections
  for each row execute function public._sync_before_write('rejections', 'id');
create unique index if not exists saved_videos_user_seq on public.saved_videos (user_id, seq);   -- the pull path
create index if not exists saved_videos_ix1 on public.saved_videos (user_id, yt_id);
drop trigger if exists saved_videos_sync on public.saved_videos;
create trigger saved_videos_sync before insert or update on public.saved_videos
  for each row execute function public._sync_before_write('videos', 'id');
create unique index if not exists channels_user_seq on public.channels (user_id, seq);   -- the pull path
drop trigger if exists channels_sync on public.channels;
create trigger channels_sync before insert or update on public.channels
  for each row execute function public._sync_before_write('channels', 'id');
create unique index if not exists courses_user_seq on public.courses (user_id, seq);   -- the pull path
drop trigger if exists courses_sync on public.courses;
create trigger courses_sync before insert or update on public.courses
  for each row execute function public._sync_before_write('courses', 'id');
create unique index if not exists one_logs_user_seq on public.one_logs (user_id, seq);   -- the pull path
create index if not exists one_logs_ix1 on public.one_logs (user_id, log_date);
drop trigger if exists one_logs_sync on public.one_logs;
create trigger one_logs_sync before insert or update on public.one_logs
  for each row execute function public._sync_before_write('oneLogs', 'id');
create unique index if not exists wake_log_user_seq on public.wake_log (user_id, seq);   -- the pull path
create index if not exists wake_log_ix1 on public.wake_log (user_id, wake_date);
drop trigger if exists wake_log_sync on public.wake_log;
create trigger wake_log_sync before insert or update on public.wake_log
  for each row execute function public._sync_before_write('wake', 'id');
create unique index if not exists settings_user_seq on public.settings (user_id, seq);   -- the pull path
drop trigger if exists settings_sync on public.settings;
create trigger settings_sync before insert or update on public.settings
  for each row execute function public._sync_before_write('meta', 'id');
create unique index if not exists preferences_user_seq on public.preferences (user_id, seq);   -- the pull path
drop trigger if exists preferences_sync on public.preferences;
create trigger preferences_sync before insert or update on public.preferences
  for each row execute function public._sync_before_write('kv', 'key');
do $$
declare t text;
begin
  foreach t in array array['habits','habit_logs','tasks','routine_blocks','workouts','body_log','journal_entries','rewards','xp_events','books','conversations','rejections','saved_videos','channels','courses','one_logs','wake_log','settings','preferences','workout_sets','workout_queue_items','body_measurements','course_lectures'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || ' select own', t);
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)', t || ' select own', t);
  end loop;
  -- realtime: the parent tables only (children always change together with their parent in one transaction)
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['habits','habit_logs','tasks','routine_blocks','workouts','body_log','journal_entries','rewards','xp_events','books','conversations','rejections','saved_videos','channels','courses','one_logs','wake_log','settings','preferences'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
-- ===================================================================================================================
-- 4. PER-COLLECTION MAPPING: _to_json_<table>(row) rebuilds the exact JSON the app stores; _apply_<table>(...) writes JSON back.
-- to_json omits NULL columns (the app omits absent optional fields; jsonb_strip_nulls). Unknown JSON keys are not stored.
-- apply = validate types (LD001 -> 'rejected'), then INSERT ... ON CONFLICT DO UPDATE (the trigger bumps version/seq), then
-- replace the child rows. It runs under push_records' per-user lock, inside the per-item sub-transaction.
-- ===================================================================================================================

-- habits ----------------------------------------------------------------------------------------------------------
create or replace function public._to_json_habits(r public.habits) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', r.id, 'name', r.name, 'stat', r.stat, 'xp', r.xp, 'minimum', r.minimum, 'archived', r.archived,
    'cadence', case r.cadence_type when 'daily'  then jsonb_build_object('type', 'daily')
                                   when 'weekly' then jsonb_build_object('type', 'weekly', 'perWeek', r.cadence_per_week)
                                   else jsonb_build_object('type', 'days', 'days', to_jsonb(r.cadence_days)) end,
    'unit', case when r.unit_label is null then null else jsonb_build_object('label', r.unit_label, 'target', r.unit_target) end)) $$;
create or replace function public._apply_habits(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare cad jsonb := public._jobj(d, 'cadence'); un jsonb := public._jobj(d, 'unit', false); ct text := cad ->> 'type';
        pw smallint; dy smallint[]; ul text; ut numeric;
begin
  perform public._jid(d, p_id);
  if ct = 'weekly' then pw := public._jint(cad, 'perWeek');
  elsif ct = 'days' then dy := public._jintarr(cad, 'days');
  elsif ct is distinct from 'daily' then raise exception 'cadence.type must be daily, weekly or days' using errcode = 'LD001'; end if;
  if un is not null then ul := public._jtext(un, 'label'); ut := public._jnum(un, 'target'); end if;
  insert into public.habits as t (user_id, id, name, stat, xp, minimum, archived, cadence_type, cadence_per_week, cadence_days, unit_label, unit_target, device_id)
  values (p_uid, p_id, public._jtext(d, 'name'), public._jtext(d, 'stat'), public._jint(d, 'xp'), public._jtext(d, 'minimum', false), public._jbool(d, 'archived', false),
          ct, pw, dy, ul, ut, p_dev)
  on conflict (user_id, id) do update set name = excluded.name, stat = excluded.stat, xp = excluded.xp, minimum = excluded.minimum, archived = excluded.archived,
    cadence_type = excluded.cadence_type, cadence_per_week = excluded.cadence_per_week, cadence_days = excluded.cadence_days,
    unit_label = excluded.unit_label, unit_target = excluded.unit_target, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- habitLogs -------------------------------------------------------------------------------------------------------
create or replace function public._to_json_habit_logs(r public.habit_logs) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'habitId', r.habit_id, 'date', public._d(r.log_date), 'level', r.level, 'amount', r.amount, 'note', r.note)) $$;
create or replace function public._apply_habit_logs(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.habit_logs as t (user_id, id, habit_id, log_date, level, amount, note, device_id)
  values (p_uid, p_id, public._jtext(d, 'habitId'), public._jdate(d, 'date'), public._jtext(d, 'level'), public._jnum(d, 'amount', false), public._jtext(d, 'note', false), p_dev)
  on conflict (user_id, id) do update set habit_id = excluded.habit_id, log_date = excluded.log_date, level = excluded.level, amount = excluded.amount,
    note = excluded.note, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- tasks -----------------------------------------------------------------------------------------------------------
create or replace function public._to_json_tasks(r public.tasks) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', r.id, 'title', r.title, 'done', r.done, 'doneAt', public._ts(r.done_at), 'date', public._d(r.task_date), 'context', r.context,
    'tags', to_jsonb(r.tags), 'parentId', r.parent_id, 'horizon', r.horizon, 'effort', r.effort, 'stat', r.stat,
    'recurrence', case when r.recurrence_every is null then null else jsonb_build_object('every', r.recurrence_every, 'interval', r.recurrence_interval) end)) $$;
create or replace function public._apply_tasks(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare rc jsonb := public._jobj(d, 'recurrence', false); re text; ri smallint;
begin
  perform public._jid(d, p_id);
  if rc is not null then re := public._jtext(rc, 'every'); ri := public._jint(rc, 'interval'); end if;
  insert into public.tasks as t (user_id, id, title, done, done_at, task_date, context, tags, parent_id, recurrence_every, recurrence_interval, horizon, effort, stat, device_id)
  values (p_uid, p_id, public._jtext(d, 'title'), public._jbool(d, 'done'), public._jts(d, 'doneAt', false), public._jdate(d, 'date', false), public._jtext(d, 'context'),
          public._jtextarr(d, 'tags'), public._jtext(d, 'parentId', false), re, ri, public._jtext(d, 'horizon', false), public._jint(d, 'effort'), public._jtext(d, 'stat'), p_dev)
  on conflict (user_id, id) do update set title = excluded.title, done = excluded.done, done_at = excluded.done_at, task_date = excluded.task_date,
    context = excluded.context, tags = excluded.tags, parent_id = excluded.parent_id, recurrence_every = excluded.recurrence_every,
    recurrence_interval = excluded.recurrence_interval, horizon = excluded.horizon, effort = excluded.effort, stat = excluded.stat,
    deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- blocks ----------------------------------------------------------------------------------------------------------
create or replace function public._to_json_routine_blocks(r public.routine_blocks) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'title', r.title, 'start', public._t(r.start_time), 'end', public._t(r.end_time),
    'day', r.day_kind, 'kind', r.kind, 'fixed', r.fixed, 'habitId', r.habit_id)) $$;
create or replace function public._apply_routine_blocks(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.routine_blocks as t (user_id, id, title, start_time, end_time, day_kind, kind, fixed, habit_id, device_id)
  values (p_uid, p_id, public._jtext(d, 'title'), public._jtime(d, 'start'), public._jtime(d, 'end'), public._jtext(d, 'day'), public._jtext(d, 'kind'),
          public._jbool(d, 'fixed', false), public._jtext(d, 'habitId', false), p_dev)
  on conflict (user_id, id) do update set title = excluded.title, start_time = excluded.start_time, end_time = excluded.end_time, day_kind = excluded.day_kind,
    kind = excluded.kind, fixed = excluded.fixed, habit_id = excluded.habit_id, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- workouts (+ workout_sets, workout_queue_items) ------------------------------------------------------------------
create or replace function public._to_json_workouts(r public.workouts) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', r.id, 'date', public._d(r.workout_date), 'name', r.name, 'notes', r.notes, 'planId', r.plan_id,
    'sets', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', s.id, 'exercise', s.exercise, 'reps', s.reps, 'weight', s.weight, 'unit', s.unit, 'note', s.note))
                                       order by s.position)
                        from public.workout_sets s where s.user_id = r.user_id and s.workout_id = r.id), '[]'::jsonb),
    'queue', case when r.has_queue then coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', q.id, 'name', q.name, 'sets', q.sets, 'reps', q.reps, 'unit', q.unit,
                                       'demo', q.demo, 'text', q.instructions, 'note', q.note, 'skipped', q.skipped)) order by q.position)
                        from public.workout_queue_items q where q.user_id = r.user_id and q.workout_id = r.id), '[]'::jsonb) end)) $$;
create or replace function public._apply_workouts(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sets jsonb := public._jarr(d, 'sets'); q jsonb := public._jarr(d, 'queue', false); e jsonb; i int;
begin
  perform public._jid(d, p_id);
  insert into public.workouts as t (user_id, id, workout_date, name, notes, plan_id, has_queue, device_id)
  values (p_uid, p_id, public._jdate(d, 'date'), public._jtext(d, 'name'), public._jtext(d, 'notes', false), public._jtext(d, 'planId', false), q is not null, p_dev)
  on conflict (user_id, id) do update set workout_date = excluded.workout_date, name = excluded.name, notes = excluded.notes, plan_id = excluded.plan_id,
    has_queue = excluded.has_queue, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
  delete from public.workout_sets where user_id = p_uid and workout_id = p_id;
  delete from public.workout_queue_items where user_id = p_uid and workout_id = p_id;
  i := 0;
  for e in select * from jsonb_array_elements(sets) loop
    insert into public.workout_sets (user_id, workout_id, position, id, exercise, reps, weight, unit, note)
    values (p_uid, p_id, i, public._jtext(e, 'id'), public._jtext(e, 'exercise'), public._jint(e, 'reps'), public._jnum(e, 'weight'), public._jtext(e, 'unit'), public._jtext(e, 'note', false));
    i := i + 1;
  end loop;
  if q is not null then
    i := 0;
    for e in select * from jsonb_array_elements(q) loop
      insert into public.workout_queue_items (user_id, workout_id, position, id, name, sets, reps, unit, demo, instructions, note, skipped)
      values (p_uid, p_id, i, public._jtext(e, 'id'), public._jtext(e, 'name'), public._jint(e, 'sets'), public._jint(e, 'reps'), public._jtext(e, 'unit'),
              public._jtext(e, 'demo', false), public._jtext(e, 'text', false), public._jtext(e, 'note', false), public._jbool(e, 'skipped', false));
      i := i + 1;
    end loop;
  end if;
end $$;

-- body (+ body_measurements) --------------------------------------------------------------------------------------
create or replace function public._to_json_body_log(r public.body_log) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'date', public._d(r.entry_date), 'weightKg', r.weight_kg, 'photo', r.photo,
    'measurements', case when r.measurements_set then coalesce((select jsonb_object_agg(m.name, m.value) from public.body_measurements m
                                                                  where m.user_id = r.user_id and m.entry_id = r.id), '{}'::jsonb) end)) $$;
create or replace function public._apply_body_log(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m jsonb := public._jobj(d, 'measurements', false); k text;
begin
  perform public._jid(d, p_id);
  insert into public.body_log as t (user_id, id, entry_date, weight_kg, measurements_set, photo, device_id)
  values (p_uid, p_id, public._jdate(d, 'date'), public._jnum(d, 'weightKg', false), m is not null, public._jtext(d, 'photo', false), p_dev)
  on conflict (user_id, id) do update set entry_date = excluded.entry_date, weight_kg = excluded.weight_kg, measurements_set = excluded.measurements_set,
    photo = excluded.photo, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
  delete from public.body_measurements where user_id = p_uid and entry_id = p_id;
  if m is not null then
    for k in select jsonb_object_keys(m) loop
      insert into public.body_measurements (user_id, entry_id, name, value) values (p_uid, p_id, k, public._jnum(m, k));
    end loop;
  end if;
end $$;

-- journal ---------------------------------------------------------------------------------------------------------
create or replace function public._to_json_journal_entries(r public.journal_entries) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'date', public._d(r.entry_date), 'body', r.body, 'kind', r.kind, 'mood', r.mood, 'energy', r.energy)) $$;
create or replace function public._apply_journal_entries(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.journal_entries as t (user_id, id, entry_date, body, kind, mood, energy, device_id)
  values (p_uid, p_id, public._jdate(d, 'date'), public._jtext(d, 'body'), public._jtext(d, 'kind'), public._jint(d, 'mood', false), public._jint(d, 'energy', false), p_dev)
  on conflict (user_id, id) do update set entry_date = excluded.entry_date, body = excluded.body, kind = excluded.kind, mood = excluded.mood, energy = excluded.energy,
    deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- rewards ---------------------------------------------------------------------------------------------------------
create or replace function public._to_json_rewards(r public.rewards) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'title', r.title, 'cost', r.cost, 'claimedAt', public._ts(r.claimed_at))) $$;
create or replace function public._apply_rewards(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.rewards as t (user_id, id, title, cost, claimed_at, device_id)
  values (p_uid, p_id, public._jtext(d, 'title'), public._jint(d, 'cost'), public._jts(d, 'claimedAt', false), p_dev)
  on conflict (user_id, id) do update set title = excluded.title, cost = excluded.cost, claimed_at = excluded.claimed_at, deleted = false,
    device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- xp --------------------------------------------------------------------------------------------------------------
create or replace function public._to_json_xp_events(r public.xp_events) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'date', public._d(r.event_date), 'stat', r.stat, 'amount', r.amount, 'reason', r.reason, 'ref', r.ref)) $$;
create or replace function public._apply_xp_events(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.xp_events as t (user_id, id, event_date, stat, amount, reason, ref, device_id)
  values (p_uid, p_id, public._jdate(d, 'date'), public._jtext(d, 'stat'), public._jint(d, 'amount'), public._jtext(d, 'reason'), public._jtext(d, 'ref', false), p_dev)
  on conflict (user_id, id) do update set event_date = excluded.event_date, stat = excluded.stat, amount = excluded.amount, reason = excluded.reason, ref = excluded.ref,
    deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- books -----------------------------------------------------------------------------------------------------------
create or replace function public._to_json_books(r public.books) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'title', r.title, 'author', r.author, 'status', r.status, 'kind', r.kind, 'pages', r.pages, 'page', r.page,
    'startedAt', public._d(r.started_on), 'finishedAt', public._d(r.finished_on), 'rating', r.rating)) $$;
create or replace function public._apply_books(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.books as t (user_id, id, title, author, status, kind, pages, page, started_on, finished_on, rating, device_id)
  values (p_uid, p_id, public._jtext(d, 'title'), public._jtext(d, 'author', false), public._jtext(d, 'status'), public._jtext(d, 'kind', false), public._jint(d, 'pages', false),
          public._jint(d, 'page', false), public._jdate(d, 'startedAt', false), public._jdate(d, 'finishedAt', false), public._jint(d, 'rating', false), p_dev)
  on conflict (user_id, id) do update set title = excluded.title, author = excluded.author, status = excluded.status, kind = excluded.kind, pages = excluded.pages,
    page = excluded.page, started_on = excluded.started_on, finished_on = excluded.finished_on, rating = excluded.rating, deleted = false,
    device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- conversations ---------------------------------------------------------------------------------------------------
create or replace function public._to_json_conversations(r public.conversations) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'date', public._d(r.convo_date), 'who', r.who, 'note', r.note)) $$;
create or replace function public._apply_conversations(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.conversations as t (user_id, id, convo_date, who, note, device_id)
  values (p_uid, p_id, public._jdate(d, 'date'), public._jtext(d, 'who'), public._jtext(d, 'note', false), p_dev)
  on conflict (user_id, id) do update set convo_date = excluded.convo_date, who = excluded.who, note = excluded.note, deleted = false,
    device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- rejections ------------------------------------------------------------------------------------------------------
create or replace function public._to_json_rejections(r public.rejections) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'date', public._d(r.rejection_date), 'createdAt', public._ts(r.logged_at), 'what', r.what, 'who', r.who, 'note', r.note)) $$;
create or replace function public._apply_rejections(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.rejections as t (user_id, id, rejection_date, logged_at, what, who, note, device_id)
  values (p_uid, p_id, public._jdate(d, 'date'), public._jts(d, 'createdAt'), public._jtext(d, 'what'), public._jtext(d, 'who', false), public._jtext(d, 'note', false), p_dev)
  on conflict (user_id, id) do update set rejection_date = excluded.rejection_date, logged_at = excluded.logged_at, what = excluded.what, who = excluded.who,
    note = excluded.note, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- videos ----------------------------------------------------------------------------------------------------------
create or replace function public._to_json_saved_videos(r public.saved_videos) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'ytId', r.yt_id, 'title', r.title, 'tag', r.tag, 'addedAt', public._ts(r.added_at), 'watchedAt', public._ts(r.watched_at))) $$;
create or replace function public._apply_saved_videos(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.saved_videos as t (user_id, id, yt_id, title, tag, added_at, watched_at, device_id)
  values (p_uid, p_id, public._jtext(d, 'ytId'), public._jtext(d, 'title'), public._jtext(d, 'tag'), public._jts(d, 'addedAt'), public._jts(d, 'watchedAt', false), p_dev)
  on conflict (user_id, id) do update set yt_id = excluded.yt_id, title = excluded.title, tag = excluded.tag, added_at = excluded.added_at, watched_at = excluded.watched_at,
    deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- channels --------------------------------------------------------------------------------------------------------
create or replace function public._to_json_channels(r public.channels) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'handle', r.handle, 'cid', r.cid, 'topic', r.topic, 'sub', r.sub, 'name', r.name, 'about', r.about,
    'list', r.list_name, 'origin', r.origin)) $$;
create or replace function public._apply_channels(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.channels as t (user_id, id, handle, cid, topic, sub, name, about, list_name, origin, device_id)
  values (p_uid, p_id, public._jtext(d, 'handle'), public._jtext(d, 'cid', false), public._jtext(d, 'topic'), public._jtext(d, 'sub', false), public._jtext(d, 'name', false),
          public._jtext(d, 'about', false), public._jtext(d, 'list', false), public._jtext(d, 'origin', false), p_dev)
  on conflict (user_id, id) do update set handle = excluded.handle, cid = excluded.cid, topic = excluded.topic, sub = excluded.sub, name = excluded.name, about = excluded.about,
    list_name = excluded.list_name, origin = excluded.origin, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- courses (+ course_lectures) -------------------------------------------------------------------------------------
create or replace function public._to_json_courses(r public.courses) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'by', r.author, 'topic', r.topic, 'sub', r.sub, 'list', r.list_name,
    'origin', r.origin, 'url', r.url, 'count', r.lecture_count, 'about', r.about,
    'videosAt', case when r.lectures_fetched_at is null then null else round(extract(epoch from r.lectures_fetched_at) * 1000)::bigint end,
    'videos', case when r.lectures_set then coalesce((select jsonb_agg(jsonb_build_array(l.yt_id, l.title, l.duration_s) order by l.position)
                       from public.course_lectures l where l.user_id = r.user_id and l.course_id = r.id), '[]'::jsonb) end)) $$;
create or replace function public._apply_courses(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb := public._jarr(d, 'videos', false); e jsonb; i int := 0; ms numeric := public._jnum(d, 'videosAt', false);
begin
  perform public._jid(d, p_id);
  insert into public.courses as t (user_id, id, kind, title, author, topic, sub, list_name, origin, url, lecture_count, about, lectures_set, lectures_fetched_at, device_id)
  values (p_uid, p_id, public._jtext(d, 'kind'), public._jtext(d, 'title'), public._jtext(d, 'by', false), public._jtext(d, 'topic'), public._jtext(d, 'sub', false),
          public._jtext(d, 'list'), public._jtext(d, 'origin'), public._jtext(d, 'url', false), public._jint(d, 'count', false), public._jtext(d, 'about', false),
          v is not null, case when ms is null then null else to_timestamp(ms / 1000.0) end, p_dev)
  on conflict (user_id, id) do update set kind = excluded.kind, title = excluded.title, author = excluded.author, topic = excluded.topic, sub = excluded.sub,
    list_name = excluded.list_name, origin = excluded.origin, url = excluded.url, lecture_count = excluded.lecture_count, about = excluded.about,
    lectures_set = excluded.lectures_set, lectures_fetched_at = excluded.lectures_fetched_at, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
  delete from public.course_lectures where user_id = p_uid and course_id = p_id;
  if v is not null then
    for e in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(e) <> 'array' or jsonb_array_length(e) <> 3 or jsonb_typeof(e -> 0) <> 'string' or jsonb_typeof(e -> 1) <> 'string' or jsonb_typeof(e -> 2) <> 'number' then
        raise exception 'videos must be [ytId, title, seconds] triples' using errcode = 'LD001';
      end if;
      insert into public.course_lectures (user_id, course_id, position, yt_id, title, duration_s)
      values (p_uid, p_id, i, e ->> 0, e ->> 1, public._jint(jsonb_build_object('s', e -> 2), 's'));
      i := i + 1;
    end loop;
  end if;
end $$;

-- oneLogs ---------------------------------------------------------------------------------------------------------
create or replace function public._to_json_one_logs(r public.one_logs) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'date', public._d(r.log_date), 'exercise', r.exercise, 'sets', r.sets, 'reps', r.reps, 'effort', r.effort)) $$;
create or replace function public._apply_one_logs(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.one_logs as t (user_id, id, log_date, exercise, sets, reps, effort, device_id)
  values (p_uid, p_id, public._jdate(d, 'date'), public._jtext(d, 'exercise'), public._jint(d, 'sets'), public._jint(d, 'reps'), public._jint(d, 'effort', false), p_dev)
  on conflict (user_id, id) do update set log_date = excluded.log_date, exercise = excluded.exercise, sets = excluded.sets, reps = excluded.reps, effort = excluded.effort,
    deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- wake ------------------------------------------------------------------------------------------------------------
create or replace function public._to_json_wake_log(r public.wake_log) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('date', public._d(r.wake_date), 'time', public._t(r.wake_time)) $$;
create or replace function public._apply_wake_log(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare wd date := public._jdate(d, 'date');
begin
  if jsonb_typeof(d) is distinct from 'object' or p_id is distinct from 'wake:' || public._d(wd) then raise exception 'wake item id must be wake:<date>' using errcode = 'LD001'; end if;
  insert into public.wake_log as t (user_id, id, wake_date, wake_time, device_id)
  values (p_uid, p_id, wd, public._jtime(d, 'time'), p_dev)
  on conflict (user_id, id) do update set wake_date = excluded.wake_date, wake_time = excluded.wake_time, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- meta (settings) -------------------------------------------------------------------------------------------------
create or replace function public._to_json_settings(r public.settings) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'theme', r.theme, 'skin', r.skin, 'wakeTime', public._t(r.wake_time), 'weekendWake', public._t(r.weekend_wake),
    'name', r.display_name, 'settledThrough', public._d(r.settled_through))) $$;
create or replace function public._apply_settings(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  if p_id <> 'settings' then raise exception 'the settings item id must be settings' using errcode = 'LD001'; end if;
  insert into public.settings as t (user_id, id, theme, skin, wake_time, weekend_wake, display_name, settled_through, device_id)
  values (p_uid, p_id, public._jtext(d, 'theme'), public._jtext(d, 'skin', false), public._jtime(d, 'wakeTime'), public._jtime(d, 'weekendWake', false), public._jtext(d, 'name'),
          public._jdate(d, 'settledThrough', false), p_dev)
  on conflict (user_id, id) do update set theme = excluded.theme, skin = excluded.skin, wake_time = excluded.wake_time, weekend_wake = excluded.weekend_wake,
    display_name = excluded.display_name, settled_through = excluded.settled_through, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- kv --------------------------------------------------------------------------------------------------------------
create or replace function public._to_json_preferences(r public.preferences) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', r.key, 'value', r.value) $$;
create or replace function public._apply_preferences(p_uid uuid, p_id text, d jsonb, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._jid(d, p_id);
  insert into public.preferences as t (user_id, key, value, device_id)
  values (p_uid, p_id, public._jtext(d, 'value'), p_dev)
  on conflict (user_id, key) do update set value = excluded.value, deleted = false, device_id = coalesce(excluded.device_id, t.device_id);
end $$;

-- registry rows ---------------------------------------------------------------------------------------------------
insert into public._sync_registry (collection, table_name, key_col, to_json_fn, apply_fn, scrub, child_tables, child_fk) values
  ('habits',        'habits',          'id',  '_to_json_habits',          '_apply_habits',          null, null, null),
  ('habitLogs',     'habit_logs',      'id',  '_to_json_habit_logs',      '_apply_habit_logs',      'note = null', null, null),
  ('tasks',         'tasks',           'id',  '_to_json_tasks',           '_apply_tasks',           null, null, null),
  ('blocks',        'routine_blocks',  'id',  '_to_json_routine_blocks',  '_apply_routine_blocks',  null, null, null),
  ('workouts',      'workouts',        'id',  '_to_json_workouts',        '_apply_workouts',        'notes = null', array['workout_sets','workout_queue_items'], 'workout_id'),
  ('body',          'body_log',        'id',  '_to_json_body_log',        '_apply_body_log',        'photo = null', array['body_measurements'], 'entry_id'),
  ('journal',       'journal_entries', 'id',  '_to_json_journal_entries', '_apply_journal_entries', 'body = ''''', null, null),
  ('rewards',       'rewards',         'id',  '_to_json_rewards',         '_apply_rewards',         null, null, null),
  ('xp',            'xp_events',       'id',  '_to_json_xp_events',       '_apply_xp_events',       null, null, null),
  ('books',         'books',           'id',  '_to_json_books',           '_apply_books',           null, null, null),
  ('conversations', 'conversations',   'id',  '_to_json_conversations',   '_apply_conversations',   'note = null', null, null),
  ('rejections',    'rejections',      'id',  '_to_json_rejections',      '_apply_rejections',      'what = '''', note = null, who = null', null, null),
  ('videos',        'saved_videos',    'id',  '_to_json_saved_videos',    '_apply_saved_videos',    null, null, null),
  ('channels',      'channels',        'id',  '_to_json_channels',        '_apply_channels',        null, null, null),
  ('courses',       'courses',         'id',  '_to_json_courses',         '_apply_courses',         null, array['course_lectures'], 'course_id'),
  ('oneLogs',       'one_logs',        'id',  '_to_json_one_logs',        '_apply_one_logs',        null, null, null),
  ('wake',          'wake_log',        'id',  '_to_json_wake_log',        '_apply_wake_log',        null, null, null),
  ('meta',          'settings',        'id',  '_to_json_settings',        '_apply_settings',        null, null, null),
  ('kv',            'preferences',     'key', '_to_json_preferences',     '_apply_preferences',     null, null, null)
on conflict (collection) do update set table_name = excluded.table_name, key_col = excluded.key_col, to_json_fn = excluded.to_json_fn, apply_fn = excluded.apply_fn,
  scrub = excluded.scrub, child_tables = excluded.child_tables, child_fk = excluded.child_fk;

-- Generic dispatch. One item in (collection, id, data, deleted) -> the right table(s). No version check here (push_records does that).
create or replace function public._write_item(p_uid uuid, p_coll text, p_id text, p_data jsonb, p_deleted boolean, p_dev text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare reg public._sync_registry; ct text;
begin
  select * into reg from public._sync_registry where collection = p_coll;
  if not found then raise exception 'unknown collection' using errcode = 'LD001'; end if;
  if p_deleted then
    execute format('update public.%I set deleted = true, device_id = coalesce($3, device_id)%s where user_id = $1 and %I = $2',
                   reg.table_name, coalesce(', ' || reg.scrub, ''), reg.key_col) using p_uid, p_id, p_dev;
    if reg.child_tables is not null then
      foreach ct in array reg.child_tables loop
        execute format('delete from public.%I where user_id = $1 and %I = $2', ct, reg.child_fk) using p_uid, p_id;
      end loop;
    end if;
  else
    execute format('select public.%I($1, $2, $3, $4)', reg.apply_fn) using p_uid, p_id, p_data, p_dev;
  end if;
end $$;

-- One row in the RemoteRow envelope ({collection,id,data,deleted,version,seq,updated_at,device_id}); null when absent.
create or replace function public._envelope(p_uid uuid, p_coll text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare reg public._sync_registry; j jsonb;
begin
  select * into reg from public._sync_registry where collection = p_coll;
  execute format($f$select jsonb_build_object('collection', %L::text, 'id', t.%I, 'data', case when t.deleted then '{}'::jsonb else public.%I(t) end,
                          'deleted', t.deleted, 'version', t.version, 'seq', t.seq, 'updated_at', t.updated_at, 'device_id', t.device_id)
                   from public.%I t where t.user_id = $1 and t.%I = $2$f$, p_coll, reg.key_col, reg.to_json_fn, reg.table_name, reg.key_col) into j using p_uid, p_id;
  return j;
end $$;

-- All rows of one user with seq > p_after, ordered by seq, as RemoteRow. p_limit null = no limit. p_live_only drops tombstones (backups).
-- Each table contributes at most p_limit rows through its (user_id, seq) index BEFORE the JSON is built; the outer sort merges them.
create or replace function public._changes(p_uid uuid, p_after bigint, p_limit int, p_live_only boolean default false)
returns table (collection text, id text, data jsonb, deleted boolean, version bigint, seq bigint, updated_at timestamptz, device_id text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q text;
begin
  select string_agg(format($f$(select %L::text as collection, t.%I::text as id, case when t.deleted then '{}'::jsonb else public.%I(t) end as data, t.deleted, t.version, t.seq, t.updated_at, t.device_id
                              from (select * from public.%I x where x.user_id = $1 and x.seq > $2 and ($4 is false or not x.deleted) order by x.seq limit $3) t)$f$,
                           r.collection, r.key_col, r.to_json_fn, r.table_name), ' union all ' order by r.collection) into q from public._sync_registry r;
  return query execute 'select * from (' || q || ') u order by u.seq limit $3' using p_uid, p_after, p_limit, p_live_only;
end $$;
revoke all on function public._write_item(uuid, text, text, jsonb, boolean, text), public._envelope(uuid, text, text),
  public._changes(uuid, bigint, int, boolean) from public, anon, authenticated;

-- ===================================================================================================================
-- 5. MIGRATION: copy LIVE rows of public.records into the typed tables (public.records is NOT modified, nothing is deleted).
-- Idempotent: ON CONFLICT DO NOTHING (re-running only adds rows that are missing; it never overwrites). version, seq, created_at, updated_at
-- and device_id are carried over, so base versions and cursors held by browsers stay valid. Each collection is one statement; if a
-- statement fails (a legacy row violating a rule) the collection falls back to row-by-row through the same _apply_* functions and
-- the rows that cannot be mapped are listed in public.migration_skipped instead of aborting the migration.
-- Legacy tombstones (deleted rows, data = {}) have no content to store: only their version floor is kept (see docs/SCHEMA.md).
-- ===================================================================================================================
lock table public.records in share row exclusive mode;      -- no concurrent writes to records while we copy (released at commit)
select set_config('ledger.migrating', '1', true);           -- transaction-local: keep version/seq/timestamps from records

create or replace function public._migrate_rowwise(p_coll text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare reg public._sync_registry; r public.records; n int;
begin
  select * into reg from public._sync_registry where collection = p_coll;
  for r in select * from public.records x where x.collection = p_coll and not x.deleted loop
    execute format('select count(*) from public.%I where user_id = $1 and %I = $2', reg.table_name, reg.key_col) into n using r.user_id, r.id;
    if n > 0 then continue; end if;
    begin
      perform public._write_item(r.user_id, r.collection, r.id, r.data, false, r.device_id);
      execute format('update public.%I set version = $3, seq = $4, created_at = $5, updated_at = $6 where user_id = $1 and %I = $2', reg.table_name, reg.key_col)
        using r.user_id, r.id, r.version, r.seq, r.created_at, r.updated_at;
    exception when others then
      insert into public.migration_skipped (user_id, collection, id, reason) values (r.user_id, r.collection, r.id, sqlstate || ': ' || sqlerrm);
    end;
  end loop;
end $$;
revoke all on function public._migrate_rowwise(text) from public, anon, authenticated;

-- A local macro: the common columns are always  user_id, id, version, seq, deleted=false, device_id, created_at, updated_at.
do $m$ begin insert into public.habits (user_id, id, name, stat, xp, minimum, archived, cadence_type, cadence_per_week, cadence_days, unit_label, unit_target, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'name', r.data ->> 'stat', (r.data ->> 'xp')::numeric::integer, r.data ->> 'minimum', (r.data ->> 'archived')::boolean,
         r.data #>> '{cadence,type}', (r.data #>> '{cadence,perWeek}')::numeric::smallint,
         case when r.data #>> '{cadence,type}' = 'days' then array(select (e)::smallint from jsonb_array_elements_text(r.data #> '{cadence,days}') e) end,
         r.data #>> '{unit,label}', (r.data #>> '{unit,target}')::numeric, r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'habits' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'habits: set-based copy failed (%), falling back to row-by-row', sqlerrm; perform public._migrate_rowwise('habits'); end $m$;

do $m$ begin insert into public.habit_logs (user_id, id, habit_id, log_date, level, amount, note, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'habitId', (r.data ->> 'date')::date, r.data ->> 'level', (r.data ->> 'amount')::numeric, r.data ->> 'note',
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'habitLogs' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'habitLogs: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('habitLogs'); end $m$;

do $m$ begin insert into public.tasks (user_id, id, title, done, done_at, task_date, context, tags, parent_id, recurrence_every, recurrence_interval, horizon, effort, stat, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'title', coalesce((r.data ->> 'done')::boolean, false), public._try_ts(r.data ->> 'doneAt'), (r.data ->> 'date')::date, r.data ->> 'context',
         coalesce(array(select jsonb_array_elements_text(r.data -> 'tags')), '{}'), r.data ->> 'parentId',
         r.data #>> '{recurrence,every}', (r.data #>> '{recurrence,interval}')::numeric::smallint, r.data ->> 'horizon', (r.data ->> 'effort')::numeric::smallint, r.data ->> 'stat',
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'tasks' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'tasks: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('tasks'); end $m$;

do $m$ begin insert into public.routine_blocks (user_id, id, title, start_time, end_time, day_kind, kind, fixed, habit_id, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'title', (r.data ->> 'start')::time, (r.data ->> 'end')::time, r.data ->> 'day', r.data ->> 'kind', (r.data ->> 'fixed')::boolean, r.data ->> 'habitId',
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'blocks' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'blocks: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('blocks'); end $m$;

do $m$ begin
  insert into public.workouts (user_id, id, workout_date, name, notes, plan_id, has_queue, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, (r.data ->> 'date')::date, coalesce(r.data ->> 'name', ''), r.data ->> 'notes', r.data ->> 'planId', jsonb_typeof(r.data -> 'queue') = 'array',
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'workouts' and not r.deleted
  on conflict (user_id, id) do nothing;
  insert into public.workout_sets (user_id, workout_id, position, id, exercise, reps, weight, unit, note)
  select r.user_id, r.id, (s.ord - 1)::smallint, s.e ->> 'id', s.e ->> 'exercise', (s.e ->> 'reps')::numeric::integer, (s.e ->> 'weight')::numeric, s.e ->> 'unit', s.e ->> 'note'
    from public.records r join public.workouts w on w.user_id = r.user_id and w.id = r.id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data -> 'sets') = 'array' then r.data -> 'sets' else '[]'::jsonb end) with ordinality as s(e, ord)
   where r.collection = 'workouts' and not r.deleted
  on conflict (user_id, workout_id, position) do nothing;
  insert into public.workout_queue_items (user_id, workout_id, position, id, name, sets, reps, unit, demo, instructions, note, skipped)
  select r.user_id, r.id, (s.ord - 1)::smallint, s.e ->> 'id', s.e ->> 'name', (s.e ->> 'sets')::numeric::integer, (s.e ->> 'reps')::numeric::integer, s.e ->> 'unit',
         s.e ->> 'demo', s.e ->> 'text', s.e ->> 'note', (s.e ->> 'skipped')::boolean
    from public.records r join public.workouts w on w.user_id = r.user_id and w.id = r.id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data -> 'queue') = 'array' then r.data -> 'queue' else '[]'::jsonb end) with ordinality as s(e, ord)
   where r.collection = 'workouts' and not r.deleted
  on conflict (user_id, workout_id, position) do nothing;
exception when others then raise warning 'workouts: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('workouts'); end $m$;

do $m$ begin
  insert into public.body_log (user_id, id, entry_date, weight_kg, measurements_set, photo, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, (r.data ->> 'date')::date, (r.data ->> 'weightKg')::numeric, jsonb_typeof(r.data -> 'measurements') = 'object', r.data ->> 'photo',
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'body' and not r.deleted
  on conflict (user_id, id) do nothing;
  insert into public.body_measurements (user_id, entry_id, name, value)
  select r.user_id, r.id, m.key, (m.value)::numeric
    from public.records r join public.body_log b on b.user_id = r.user_id and b.id = r.id
    cross join lateral jsonb_each_text(case when jsonb_typeof(r.data -> 'measurements') = 'object' then r.data -> 'measurements' else '{}'::jsonb end) as m(key, value)
   where r.collection = 'body' and not r.deleted
  on conflict (user_id, entry_id, name) do nothing;
exception when others then raise warning 'body: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('body'); end $m$;

do $m$ begin insert into public.journal_entries (user_id, id, entry_date, body, kind, mood, energy, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, (r.data ->> 'date')::date, coalesce(r.data ->> 'body', ''), r.data ->> 'kind', (r.data ->> 'mood')::numeric::smallint, (r.data ->> 'energy')::numeric::smallint,
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'journal' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'journal: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('journal'); end $m$;

do $m$ begin insert into public.rewards (user_id, id, title, cost, claimed_at, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'title', (r.data ->> 'cost')::numeric::integer, public._try_ts(r.data ->> 'claimedAt'), r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'rewards' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'rewards: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('rewards'); end $m$;

do $m$ begin insert into public.xp_events (user_id, id, event_date, stat, amount, reason, ref, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, (r.data ->> 'date')::date, r.data ->> 'stat', (r.data ->> 'amount')::numeric::integer, coalesce(r.data ->> 'reason', ''), r.data ->> 'ref',
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'xp' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'xp: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('xp'); end $m$;

do $m$ begin insert into public.books (user_id, id, title, author, status, kind, pages, page, started_on, finished_on, rating, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'title', r.data ->> 'author', r.data ->> 'status', r.data ->> 'kind', (r.data ->> 'pages')::numeric::integer, (r.data ->> 'page')::numeric::integer,
         public._try_date(r.data ->> 'startedAt'), public._try_date(r.data ->> 'finishedAt'), (r.data ->> 'rating')::numeric::smallint,
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'books' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'books: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('books'); end $m$;

do $m$ begin insert into public.conversations (user_id, id, convo_date, who, note, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, (r.data ->> 'date')::date, coalesce(r.data ->> 'who', ''), r.data ->> 'note', r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'conversations' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'conversations: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('conversations'); end $m$;

do $m$ begin insert into public.rejections (user_id, id, rejection_date, logged_at, what, who, note, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, (r.data ->> 'date')::date, public._try_ts(r.data ->> 'createdAt'), coalesce(r.data ->> 'what', ''), r.data ->> 'who', r.data ->> 'note',
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'rejections' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'rejections: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('rejections'); end $m$;

do $m$ begin insert into public.saved_videos (user_id, id, yt_id, title, tag, added_at, watched_at, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'ytId', coalesce(r.data ->> 'title', ''), r.data ->> 'tag', public._try_ts(r.data ->> 'addedAt'), public._try_ts(r.data ->> 'watchedAt'),
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'videos' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'videos: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('videos'); end $m$;

do $m$ begin insert into public.channels (user_id, id, handle, cid, topic, sub, name, about, list_name, origin, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'handle', r.data ->> 'cid', r.data ->> 'topic', r.data ->> 'sub', r.data ->> 'name', r.data ->> 'about', r.data ->> 'list', r.data ->> 'origin',
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'channels' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'channels: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('channels'); end $m$;

do $m$ begin
  insert into public.courses (user_id, id, kind, title, author, topic, sub, list_name, origin, url, lecture_count, about, lectures_set, lectures_fetched_at, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, r.data ->> 'kind', r.data ->> 'title', r.data ->> 'by', r.data ->> 'topic', r.data ->> 'sub', r.data ->> 'list', r.data ->> 'origin', r.data ->> 'url',
         (r.data ->> 'count')::numeric::integer, r.data ->> 'about', jsonb_typeof(r.data -> 'videos') = 'array',
         case when r.data ->> 'videosAt' is null then null else to_timestamp((r.data ->> 'videosAt')::numeric / 1000.0) end,
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'courses' and not r.deleted
  on conflict (user_id, id) do nothing;
  insert into public.course_lectures (user_id, course_id, position, yt_id, title, duration_s)
  select r.user_id, r.id, (v.ord - 1)::smallint, v.e ->> 0, coalesce(v.e ->> 1, ''), (v.e ->> 2)::numeric::integer
    from public.records r join public.courses c on c.user_id = r.user_id and c.id = r.id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data -> 'videos') = 'array' then r.data -> 'videos' else '[]'::jsonb end) with ordinality as v(e, ord)
   where r.collection = 'courses' and not r.deleted
  on conflict (user_id, course_id, position) do nothing;
exception when others then raise warning 'courses: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('courses'); end $m$;

do $m$ begin insert into public.one_logs (user_id, id, log_date, exercise, sets, reps, effort, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, (r.data ->> 'date')::date, r.data ->> 'exercise', (r.data ->> 'sets')::numeric::integer, (r.data ->> 'reps')::numeric::integer, (r.data ->> 'effort')::numeric::smallint,
         r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'oneLogs' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'oneLogs: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('oneLogs'); end $m$;

do $m$ begin insert into public.wake_log (user_id, id, wake_date, wake_time, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, (r.data ->> 'date')::date, (r.data ->> 'time')::time, r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'wake' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'wake: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('wake'); end $m$;

do $m$ begin insert into public.settings (user_id, id, theme, skin, wake_time, weekend_wake, display_name, settled_through, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, 'settings', r.data ->> 'theme', r.data ->> 'skin', (r.data ->> 'wakeTime')::time, (r.data ->> 'weekendWake')::time, coalesce(r.data ->> 'name', ''),
         (r.data ->> 'settledThrough')::date, r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'meta' and r.id = 'settings' and not r.deleted
  on conflict (user_id, id) do nothing;
exception when others then raise warning 'meta: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('meta'); end $m$;

do $m$ begin insert into public.preferences (user_id, key, value, version, seq, deleted, device_id, created_at, updated_at)
  select r.user_id, r.id, coalesce(r.data ->> 'value', ''), r.version, r.seq, false, r.device_id, r.created_at, r.updated_at
    from public.records r where r.collection = 'kv' and not r.deleted
  on conflict (user_id, key) do nothing;
exception when others then raise warning 'kv: set-based copy failed (%), falling back', sqlerrm; perform public._migrate_rowwise('kv'); end $m$;

-- legacy tombstones: keep their version floor so a re-created id continues the version line (and stale devices get a conflict, not a silent overwrite)
insert into public.record_tombstone_floor (user_id, collection, id, version)
select r.user_id, r.collection, r.id, r.version from public.records r where r.deleted
on conflict (user_id, collection, id) do update set version = greatest(public.record_tombstone_floor.version, excluded.version);

select set_config('ledger.migrating', '0', true);

-- ===================================================================================================================
-- 6. VERIFICATION (read-only). Expect: missing = 0, mismatched = 0 for every collection; migration_skipped empty.
--    typed_extra = rows that exist only in the typed tables (created after the copy; 0 in a rehearsal).
-- ===================================================================================================================
create or replace function public.verify_migration()
returns table (collection text, records_live bigint, typed_live bigint, missing bigint, mismatched bigint, typed_extra bigint, legacy_tombstones bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with typed as (
    select u.user_id, c.collection, c.id, c.data from (select distinct r.user_id from public.records r) u
    cross join lateral public._changes(u.user_id, 0, null, true) c),
  src as (select r.user_id, r.collection, r.id, r.data from public.records r where not r.deleted),
  cmp as (
    select coalesce(s.collection, t.collection) as coll,
           count(s.id) as src_n, count(t.id) as typed_n,
           count(s.id) filter (where t.id is null) as miss,
           count(s.id) filter (where t.id is not null and t.data is distinct from s.data) as mism,
           count(t.id) filter (where s.id is null) as extra
      from src s full join typed t on t.user_id = s.user_id and t.collection = s.collection and t.id = s.id
     group by 1)
  select c.coll, c.src_n, c.typed_n, c.miss, c.mism, c.extra,
         (select count(*) from public.records d where d.deleted and d.collection = c.coll)
    from cmp c order by 1 $$;
revoke all on function public.verify_migration() from public, anon, authenticated;
-- run:  select * from public.verify_migration();            select * from public.migration_skipped;
-- plain counts (children too):
--   select 'records live'  as what, collection, count(*) from public.records where not deleted group by collection
--   union all select 'sets',     'workouts', count(*) from public.workout_sets
--   union all select 'queue',    'workouts', count(*) from public.workout_queue_items
--   union all select 'measure',  'body',     count(*) from public.body_measurements
--   union all select 'lectures', 'courses',  count(*) from public.course_lectures order by 2, 1;

-- ===================================================================================================================
-- 7. CUTOVER: from here on the typed tables are the source of truth. Same RPC contract, new internals.
-- ===================================================================================================================

-- 7a. strict trigger (no migration branch from now on)
create or replace function public._sync_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.seq        := nextval('public.sync_seq');
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.version    := 1 + coalesce((select f.version from public.record_tombstone_floor f
                                     where f.user_id = new.user_id and f.collection = tg_argv[0] and f.id = to_jsonb(new) ->> tg_argv[1]), 0);
    new.created_at := coalesce(new.created_at, now());
  else
    new.version    := old.version + 1;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- 7b. push_records: SAME signature, request and response as 0003/0006. Differences: routes by collection through the registry, and the
-- JSON is validated/mapped by the _apply_* functions. Per-user advisory lock, per-item sub-transaction, base_version optimistic concurrency.
-- Tombstone of an item the server never had (base 0, deleted) answers 'gone' (nothing to delete) because a tombstone has no content to store.
create or replace function public.push_records(p_items jsonb, p_device_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_n int; v_i int; v_item jsonb; v_out jsonb := '[]'::jsonb;
  v_coll text; v_id text; v_data jsonb; v_deleted boolean; v_base bigint; v_dev text := left(p_device_id, 100);
  v_status text; v_reason text; v_row jsonb; v_ver bigint; reg public._sync_registry;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a JSON array' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_items);
  if v_n > 500 then raise exception 'batch too large: % items (max 500)', v_n using errcode = '54000'; end if;
  if v_n = 0 then return '[]'::jsonb; end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger:records:' || v_uid::text, 0));   -- same key as backups: one writer per user

  for v_i in 0 .. v_n - 1 loop
    v_item := p_items -> v_i;
    v_coll := null; v_id := null; v_status := null; v_reason := null; v_row := null;
    begin
      if jsonb_typeof(v_item) <> 'object' then raise exception 'item is not an object' using errcode = 'LD001'; end if;
      if jsonb_typeof(v_item -> 'collection') = 'string' then v_coll := v_item ->> 'collection'; end if;
      if jsonb_typeof(v_item -> 'id') = 'string' then v_id := v_item ->> 'id'; end if;
      select * into reg from public._sync_registry where collection = v_coll;
      if v_coll is null or not found then raise exception 'unknown collection' using errcode = 'LD001'; end if;
      if v_id is null or char_length(v_id) < 1 or char_length(v_id) > 200 or v_id ~ '[[:cntrl:]]' then
        raise exception 'invalid id (1..200 chars, no control characters)' using errcode = 'LD001'; end if;
      if jsonb_typeof(v_item -> 'base_version') is distinct from 'number' or (v_item ->> 'base_version') !~ '^[0-9]+$' then
        raise exception 'base_version must be a non-negative integer' using errcode = 'LD001'; end if;
      v_base := (v_item ->> 'base_version')::bigint;
      if not (v_item ? 'deleted') or jsonb_typeof(v_item -> 'deleted') = 'null' then v_deleted := false;
      elsif jsonb_typeof(v_item -> 'deleted') = 'boolean' then v_deleted := (v_item ->> 'deleted')::boolean;
      else raise exception 'deleted must be a boolean' using errcode = 'LD001'; end if;
      v_data := case when v_deleted then '{}'::jsonb else v_item -> 'data' end;
      if jsonb_typeof(v_data) is distinct from 'object' then raise exception 'data must be a JSON object' using errcode = 'LD001'; end if;
      if octet_length(v_data::text) > 600000 then raise exception 'data too large (% bytes, max 600000)', octet_length(v_data::text) using errcode = 'LD001'; end if;

      -- optimistic concurrency: lock the row, compare versions
      v_ver := null;
      execute format('select version from public.%I where user_id = $1 and %I = $2 for update', reg.table_name, reg.key_col) into v_ver using v_uid, v_id;
      if v_ver is null then
        if v_base = 0 and not v_deleted then
          perform public._write_item(v_uid, v_coll, v_id, v_data, false, v_dev);
          v_status := 'ok'; v_row := public._envelope(v_uid, v_coll, v_id);
        else
          v_status := 'gone';
        end if;
      elsif v_ver = v_base then
        perform public._write_item(v_uid, v_coll, v_id, v_data, v_deleted, v_dev);
        v_status := 'ok'; v_row := public._envelope(v_uid, v_coll, v_id);
      else
        v_status := 'conflict'; v_row := public._envelope(v_uid, v_coll, v_id);
      end if;
    exception when others then
      -- validation-class errors (LD001, data exceptions 22xxx, CHECK/NOT NULL/FK 23xxx) = 'rejected' (sub-transaction rolled back, children included);
      -- anything else is transient: re-raise so the client retries the whole call.
      if sqlstate = 'LD001' or sqlstate like '22%' or sqlstate like '23%' then
        v_status := 'rejected'; v_reason := sqlerrm; v_row := null;
      else raise; end if;
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

-- 7c. pull_changes: the single cursor across all tables. Replaces  select ... from records where seq > :cursor order by seq limit :n.
create or replace function public.pull_changes(p_after bigint default 0, p_limit int default 1000)
returns table (collection text, id text, data jsonb, deleted boolean, version bigint, seq bigint, updated_at timestamptz, device_id text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return query select * from public._changes(v_uid, coalesce(p_after, 0), least(greatest(coalesce(p_limit, 1000), 1), 1000), false);
end $$;
revoke all on function public.pull_changes(bigint, int) from public, anon, authenticated;
grant execute on function public.pull_changes(bigint, int) to authenticated;

-- 7d. backups: public.record_backups and its {collection,id,data,version} payload are unchanged (old snapshots stay restorable).
create or replace function public._snapshot_user(p_uid uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_payload jsonb; v_count int; v_day date := (now() at time zone 'utc')::date; v_old int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('collection', c.collection, 'id', c.id, 'data', c.data, 'version', c.version) order by c.collection, c.id), '[]'::jsonb), count(*)
    into v_payload, v_count from public._changes(p_uid, 0, null, true) c;
  if p_kind = 'daily' then
    -- never replace today's good snapshot by a much smaller one (< 80% of its rows)
    select b.row_count into v_old from public.record_backups b where b.user_id = p_uid and b.kind = 'daily' and b.taken_on = v_day;
    if v_old is not null and v_count < v_old * 0.8 then
      return jsonb_build_object('taken_on', v_day, 'row_count', v_old, 'kept_existing', true);
    end if;
    insert into public.record_backups (user_id, taken_on, kind, payload, row_count, created_at)
    values (p_uid, v_day, 'daily', v_payload, v_count, clock_timestamp())
    on conflict (user_id, taken_on) where kind = 'daily'
    do update set payload = excluded.payload, row_count = excluded.row_count, created_at = excluded.created_at;
  else
    insert into public.record_backups (user_id, taken_on, kind, payload, row_count, created_at) values (p_uid, v_day, p_kind, v_payload, v_count, clock_timestamp());
  end if;
  return jsonb_build_object('taken_on', v_day, 'row_count', v_count);
end $$;

-- restore: snapshot rows are routed through _write_item (the same mapping as push); live rows missing from the snapshot become tombstones.
create or replace function public.restore_backup(p_date date, p_kind text default 'daily') returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_payload jsonb; v_n int := 0; v_skipped int := 0; reg public._sync_registry; e jsonb; k text; v_cur jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger:records:' || v_uid::text, 0));
  select payload into v_payload from public.record_backups where user_id = v_uid and taken_on = p_date and kind = p_kind order by created_at desc limit 1;
  if not found then raise exception 'no % backup for %', p_kind, p_date using errcode = 'P0002'; end if;
  perform public._snapshot_user(v_uid, 'pre-restore');
  -- 1. live rows that are not in the snapshot -> tombstones
  for reg in select * from public._sync_registry loop
    for k in execute format('select t.%I::text from public.%I t where t.user_id = $1 and not t.deleted
                              and not (t.%I::text = any (array(select x ->> ''id'' from jsonb_array_elements($2) x where x ->> ''collection'' = %L)))',
                            reg.key_col, reg.table_name, reg.key_col, reg.collection) using v_uid, v_payload loop
      perform public._write_item(v_uid, reg.collection, k, '{}'::jsonb, true, 'restore'); v_n := v_n + 1;
    end loop;
  end loop;
  -- 2. snapshot rows -> upsert (skip rows already identical; rows that no longer map are skipped, not fatal)
  for e in select * from jsonb_array_elements(v_payload) loop
    begin
      v_cur := public._envelope(v_uid, e ->> 'collection', e ->> 'id');
      if v_cur is not null and not (v_cur ->> 'deleted')::boolean and v_cur -> 'data' = e -> 'data' then continue; end if;
      perform public._write_item(v_uid, e ->> 'collection', e ->> 'id', e -> 'data', false, 'restore'); v_n := v_n + 1;
    exception when others then
      if sqlstate = 'LD001' or sqlstate like '22%' or sqlstate like '23%' then v_skipped := v_skipped + 1; else raise; end if;
    end;
  end loop;
  if v_skipped > 0 then raise notice 'restore_backup: skipped % row(s) that no longer satisfy the table rules', v_skipped; end if;
  return v_n;
end $$;

create or replace function public.run_nightly_backup() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid; n int := 0; q text;
begin
  select string_agg(format('select user_id from public.%I where not deleted', table_name), ' union ') into q from public._sync_registry;
  for u in execute q loop
    begin perform public._snapshot_user(u, 'daily'); n := n + 1;
    exception when others then raise warning 'nightly backup failed for %: %', u, sqlerrm; end;
  end loop;
  delete from public.record_backups where taken_on < (now() at time zone 'utc')::date - 14;
  return n;
end $$;

-- purge: tombstones older than 90 days that a later daily snapshot already excludes; remember the last version (floor). Children are already gone.
create or replace function public.purge_tombstones() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare reg public._sync_registry; n int := 0; c int;
begin
  for reg in select * from public._sync_registry loop
    execute format($f$with gone as (
        delete from public.%1$I r where r.deleted and r.updated_at < now() - interval '90 days'
           and exists (select 1 from public.record_backups b where b.user_id = r.user_id and b.kind = 'daily' and b.created_at > r.updated_at)
        returning r.user_id, r.%2$I::text as id, r.version),
      fl as (insert into public.record_tombstone_floor (user_id, collection, id, version) select user_id, %3$L, id, version from gone
        on conflict (user_id, collection, id) do update set version = greatest(public.record_tombstone_floor.version, excluded.version) returning 1)
      select count(*) from gone$f$, reg.table_name, reg.key_col, reg.collection) into c;
    n := n + c;
  end loop;
  return n;
end $$;
-- privileges and pg_cron schedules of 0004 are unchanged (take_backup / list_backups need no change: they only touch record_backups).
revoke all on function public._snapshot_user(uuid, text), public.restore_backup(date, text), public.run_nightly_backup(), public.purge_tombstones() from public, anon, authenticated;
grant execute on function public.restore_backup(date, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_nightly_backup() to service_role;
    grant execute on function public.purge_tombstones() to service_role;
  end if;
end $$;

-- 7e. freeze the old table (read-only, kept for rollback / audit). The owner renames or drops it later, by decision.
create or replace function public._records_frozen() returns trigger language plpgsql as $$
begin raise exception 'public.records is frozen: Ledger now stores data in typed tables (see docs/SCHEMA.md)' using errcode = 'LD002'; end $$;
drop trigger if exists records_frozen on public.records;
create trigger records_frozen before insert or update or delete on public.records for each statement execute function public._records_frozen();
-- ROLLBACK (before any new write): drop trigger records_frozen on public.records;  and re-apply 0006 (old push_records) + 0004 (old backup functions).
