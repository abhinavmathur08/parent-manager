-- H-06.3: server-side conflict rules for synced tables (architecture section 5, NFR-OFF-5).
--
-- Generic over tables: a feature's migration creates its table with the system columns
-- (id, household_id, version, created_at, updated_at, deleted_at) and RLS policies, then
-- calls private.enable_sync('public.<table>', array['<check column>', ...]). No feature
-- tables are created here.
--
-- The rules:
-- - The server sets created_at, updated_at and version. Client clocks are never trusted.
-- - Deletes are soft. Once deleted_at is set, the row never changes again, so an offline
--   edit can't bring it back; the editing device gets the tombstone in the response.
-- - A client sends the version its change was based on. A check column (such as
--   `checked`) that is true can't be set false by a write based on an older version, so a
--   stale "unchecked" can't override a newer "checked". The server records who set it
--   and when, in <column>_by and <column>_at.

create function private.sync_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  now_ts constant timestamptz := clock_timestamp();
  col text;
  row_json jsonb;
begin
  new.created_at := now_ts;
  new.updated_at := now_ts;
  new.version := 1;
  if new.deleted_at is not null then
    new.deleted_at := now_ts;
  end if;
  if tg_nargs > 0 then
    row_json := to_jsonb(new);
    foreach col in array tg_argv loop
      if coalesce((row_json ->> col)::boolean, false) then
        row_json := row_json || jsonb_build_object(
          col, true, col || '_at', now_ts, col || '_by', (select auth.uid()));
      else
        row_json := row_json || jsonb_build_object(col, false, col || '_at', null, col || '_by', null);
      end if;
    end loop;
    new := jsonb_populate_record(new, row_json);
  end if;
  return new;
end;
$$;

create function private.sync_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  now_ts constant timestamptz := clock_timestamp();
  -- The client sends the version it last saw; anything else means the row moved on since.
  stale constant boolean := new.version is distinct from old.version;
  col text;
  old_json jsonb;
  new_json jsonb;
  was_set boolean;
  is_set boolean;
begin
  -- A tombstone never changes. Returning the old row answers a late edit with the delete.
  if old.deleted_at is not null then
    return old;
  end if;

  new.id := old.id;
  new.household_id := old.household_id;
  new.created_at := old.created_at;

  if tg_nargs > 0 then
    old_json := to_jsonb(old);
    new_json := to_jsonb(new);
    foreach col in array tg_argv loop
      was_set := coalesce((old_json ->> col)::boolean, false);
      is_set := coalesce((new_json ->> col)::boolean, false);
      if was_set and not is_set and stale then
        is_set := true;
      end if;
      if is_set and not was_set then
        new_json := new_json || jsonb_build_object(
          col, true, col || '_at', now_ts, col || '_by', (select auth.uid()));
      elsif is_set then
        new_json := new_json || jsonb_build_object(
          col, true, col || '_at', old_json -> (col || '_at'), col || '_by', old_json -> (col || '_by'));
      else
        new_json := new_json || jsonb_build_object(col, false, col || '_at', null, col || '_by', null);
      end if;
    end loop;
    new := jsonb_populate_record(new, new_json);
  end if;

  if new.deleted_at is not null then
    new.deleted_at := now_ts;
  end if;
  new.version := old.version + 1;
  new.updated_at := now_ts;
  return new;
end;
$$;

-- Turns on the rules for a table, after checking it has the columns they need.
create function private.enable_sync(target regclass, check_columns text[] default '{}')
returns void
language plpgsql
set search_path = ''
as $$
declare
  col text;
  expected text;
  actual text;
  args text;
  table_name text;
begin
  for col, expected in
    select c, t from unnest(
      array['id', 'household_id', 'version', 'created_at', 'updated_at', 'deleted_at'],
      array['uuid', 'uuid', 'integer', 'timestamp with time zone', 'timestamp with time zone',
            'timestamp with time zone']) as s(c, t)
    union all
    select c || suffix, t
    from unnest(check_columns) c,
      (values ('', 'boolean'), ('_at', 'timestamp with time zone'), ('_by', 'uuid')) v(suffix, t)
  loop
    select format_type(atttypid, atttypmod) into actual
    from pg_catalog.pg_attribute
    where attrelid = target and attname = col and attnum > 0 and not attisdropped;
    if actual is distinct from expected then
      raise exception 'enable_sync: % needs column % of type %', target, col, expected;
    end if;
  end loop;

  if not (select relrowsecurity from pg_catalog.pg_class where oid = target) then
    raise exception 'enable_sync: % must have row-level security enabled', target;
  end if;

  select relname into table_name from pg_catalog.pg_class where oid = target;
  select coalesce(string_agg(quote_literal(c), ', '), '') into args from unnest(check_columns) c;

  execute format(
    'create trigger sync_before_insert before insert on %s for each row execute function private.sync_before_insert(%s)',
    target, args);
  execute format(
    'create trigger sync_before_update before update on %s for each row execute function private.sync_before_update(%s)',
    target, args);
  -- Deletes are soft: clients set deleted_at instead.
  execute format('revoke delete, truncate on %s from anon, authenticated', target);
  -- Pulls read a household's rows in updated_at, id order.
  execute format('create index %I on %s (household_id, updated_at, id)', table_name || '_sync_idx', target);
  -- Realtime (H-06.4) sends the table's changes to members; it applies RLS per subscriber.
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    execute format('alter publication supabase_realtime add table %s', target);
  end if;
end;
$$;

revoke all on function private.sync_before_insert() from public;
revoke all on function private.sync_before_update() from public;
revoke all on function private.enable_sync(regclass, text[]) from public;
