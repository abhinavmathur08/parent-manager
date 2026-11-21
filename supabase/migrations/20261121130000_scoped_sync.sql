-- C-01.3: per-row visibility for sync (architecture section 5, "Per-row visibility"; spec R2-ACC-2,
-- NFR2-OFF-2).
--
-- Phase 1 tables are visible to every member, so a pull by updated_at is enough. Calendar rows
-- (and later documents and busy blocks) can stop being visible to a member without changing for
-- them: an event is unshared, or the household lapses to Free, or the member is removed. Their
-- pulls never see a tombstone, so the device asks which rows it may still see and drops the rest.
--
-- A feature marks such a table with private.enable_scoped_sync('public.<table>') after
-- private.enable_sync, and with `scoped: true` in its defineSyncTable definition.

create table private.scoped_sync_tables (
  table_name regclass primary key,
  created_at timestamptz not null default now()
);

revoke all on private.scoped_sync_tables from public, anon, authenticated;

create function private.enable_scoped_sync(target regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = target and tgname = 'sync_before_update' and not tgisinternal
  ) then
    raise exception 'enable_scoped_sync: % must be synced first (private.enable_sync)', target;
  end if;
  insert into private.scoped_sync_tables (table_name) values (target)
  on conflict (table_name) do nothing;
end;
$$;

revoke all on function private.enable_scoped_sync(regclass) from public;

-- The scoped table named `target` in public, or null.
create function private.scoped_sync_table(target text)
returns regclass
language sql
stable
security definer
set search_path = ''
as $$
  select s.table_name from private.scoped_sync_tables s
  where s.table_name = to_regclass('public.' || pg_catalog.quote_ident(target))
$$;

revoke all on function private.scoped_sync_table(text) from public;
grant execute on function private.scoped_sync_table(text) to authenticated;

-- The IDs of the household's live rows of a scoped table that the caller can see now. Runs as
-- the caller, so RLS decides: another household, a paused or removed member, or an unshared
-- event gives no IDs. One array rather than a set of rows, so PostgREST's row limit never cuts
-- the list short (a cut list would drop rows from the device).
create function public.visible_ids(target text, household uuid)
returns uuid[]
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  rel constant regclass := private.scoped_sync_table(target);
  ids uuid[];
begin
  if rel is null then
    raise exception 'not a scoped sync table: %', target using errcode = '22023';
  end if;
  execute format(
    'select coalesce(array_agg(t.id order by t.id), ''{}'') from %s t where t.household_id = $1 and t.deleted_at is null',
    rel)
  into ids using household;
  return ids;
end;
$$;

revoke all on function public.visible_ids(text, uuid) from public, anon;
grant execute on function public.visible_ids(text, uuid) to authenticated;

-- The calendar's tables (C-01.1, C-01.2).
select private.enable_scoped_sync('public.events');
select private.enable_scoped_sync('public.event_people');
select private.enable_scoped_sync('public.event_reminders');
select private.enable_scoped_sync('public.event_exceptions');
