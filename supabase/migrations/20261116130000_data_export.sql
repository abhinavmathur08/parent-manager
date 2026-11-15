-- A-04.2: data export (spec FR-PRIV-2, FR-MEM-4, FR-PAY-10; architecture section 3.4).
--
-- Like deletion (A-04.3), export doesn't rely on anyone remembering a list in app code. Every
-- table that holds household or user data is registered in private.export_registry, in the
-- migration that creates it:
--
--   select private.register_for_export('public.recipes', 'household', 'household_id');
--   select private.register_for_export('public.ai_import_jobs', 'user', 'user_id');
--   select private.register_for_export('public.invite_attempts', 'none', reason => 'security record');
--
-- supabase/tests/data_export.test.sql fails if a public table with a household_id, a foreign
-- key to auth.users or households, or a user column isn't registered. The two export
-- functions read the registry, so a registered table is exported with no app change.
-- Export is free for every tier (FR-PAY-10): nothing here reads entitlements.

create table private.export_registry (
  table_name regclass not null,
  -- household: the household export, rows where key_column is the household.
  -- user: the account export, rows where key_column is the member.
  -- none: never exported; reason says why.
  scope text not null check (scope in ('household', 'user', 'none')),
  key_column text,
  -- Columns left out of the export, such as secret hashes.
  omit_columns text[] not null default '{}',
  reason text,
  primary key (table_name, scope),
  check ((scope = 'none') = (key_column is null)),
  check (scope <> 'none' or reason is not null)
);

revoke all on private.export_registry from public;

create function private.register_for_export(
  target regclass,
  scope text,
  key_column text default null,
  omit_columns text[] default '{}',
  reason text default null
)
returns void
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
begin
  if key_column is not null and not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = target and attname = key_column and attnum > 0 and not attisdropped
  ) then
    raise exception 'register_for_export: % has no column %', target, key_column;
  end if;
  insert into private.export_registry (table_name, scope, key_column, omit_columns, reason)
  values (target, scope, key_column, omit_columns, reason)
  on conflict (table_name, scope) do update
    set key_column = excluded.key_column, omit_columns = excluded.omit_columns,
        reason = excluded.reason;
end;
$$;

revoke all on function private.register_for_export(regclass, text, text, text[], text) from public;

-- The live rows of one registered table whose key column is `key`, as a JSON array.
-- Deleted rows (sync tombstones) are left out.
create function private.export_rows(target regclass, key_column text, key uuid, omit text[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  live text := '';
  result jsonb;
begin
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = target and attname = 'deleted_at' and attnum > 0 and not attisdropped
  ) then
    live := ' and t.deleted_at is null';
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - $2), ''[]''::jsonb) from %s t where t.%I = $1%s',
    target, key_column, live)
  into result using key, omit;
  return result;
end;
$$;

revoke all on function private.export_rows(regclass, text, uuid, text[]) from public;

create function private.export_scope(scope text, key uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  entry record;
  tables jsonb := '{}'::jsonb;
begin
  for entry in
    select r.table_name, c.relname::text as name, r.key_column, r.omit_columns
    from private.export_registry r
    join pg_catalog.pg_class c on c.oid = r.table_name
    where r.scope = export_scope.scope
    order by c.relname
  loop
    tables := tables || jsonb_build_object(
      entry.name, private.export_rows(entry.table_name, entry.key_column, key, entry.omit_columns));
  end loop;
  return tables;
end;
$$;

revoke all on function private.export_scope(text, uuid) from public;

-- FR-PRIV-2: a parent exports the household's data. Members' display names come with their
-- roles (household_members), from their profiles.
create function public.export_household_data(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.household_role(target) is distinct from 'parent' then
    raise exception 'only a parent of this household can export its data' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'format', 'parent-manager-export',
    'version', 1,
    'scope', 'household',
    'exported_at', now(),
    'tables', private.export_scope('household', target) || jsonb_build_object(
      'member_names', (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'display_name', p.display_name)
          order by p.id), '[]'::jsonb)
        from public.profiles p
        where p.id in (
          select m.user_id from public.household_members m
          where m.household_id = target and m.deleted_at is null))));
end;
$$;

-- FR-PRIV-2: any member exports their own account data.
create function public.export_account_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in to export your data' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'format', 'parent-manager-export',
    'version', 1,
    'scope', 'account',
    'exported_at', now(),
    'tables', private.export_scope('user', auth.uid()));
end;
$$;

revoke all on function public.export_household_data(uuid) from public, anon;
revoke all on function public.export_account_data() from public, anon;
grant execute on function public.export_household_data(uuid) to authenticated;
grant execute on function public.export_account_data() to authenticated;

-- ---------------------------------------------------------------------------
-- Every table on main (architecture section 3.4). New tables register in their own migration.
-- ---------------------------------------------------------------------------
select private.register_for_export('public.households', 'household', 'id');
select private.register_for_export('public.household_members', 'household', 'household_id');
select private.register_for_export('public.household_members', 'user', 'user_id');
select private.register_for_export('public.invitations', 'household', 'household_id',
  array['token_hash', 'code_hash']);
select private.register_for_export('public.invite_attempts', 'none',
  reason => 'a security record of join attempts, not household data');
select private.register_for_export('public.household_people', 'household', 'household_id');
select private.register_for_export('public.person_dietary', 'household', 'household_id');
select private.register_for_export('public.household_entitlements', 'household', 'household_id',
  array['rc_app_user_id']);
select private.register_for_export('public.ingredients', 'household', 'household_id');
select private.register_for_export('public.ingredient_names', 'household', 'household_id');
select private.register_for_export('public.household_ingredients', 'household', 'household_id');
select private.register_for_export('public.recipes', 'household', 'household_id');
select private.register_for_export('public.recipe_ingredients', 'household', 'household_id');
select private.register_for_export('public.recipe_steps', 'household', 'household_id');
select private.register_for_export('public.plan_entries', 'household', 'household_id');
select private.register_for_export('public.plan_entry_portions', 'household', 'household_id');
select private.register_for_export('public.pantry_items', 'household', 'household_id');
select private.register_for_export('public.grocery_lists', 'household', 'household_id');
select private.register_for_export('public.grocery_items', 'household', 'household_id');
select private.register_for_export('public.grocery_item_sources', 'household', 'household_id');
select private.register_for_export('public.purchase_events', 'household', 'household_id');
select private.register_for_export('public.frequent_suggestion_hides', 'household', 'household_id');
select private.register_for_export('public.ai_usage', 'household', 'household_id');
select private.register_for_export('public.ai_import_jobs', 'user', 'user_id');
select private.register_for_export('public.profiles', 'user', 'id');
select private.register_for_export('public.household_deletion_requests', 'none',
  reason => 'a pending action that ends in deletion, not household data');
