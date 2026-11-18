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
