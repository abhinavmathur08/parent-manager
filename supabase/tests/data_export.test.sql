-- A-04.2, FR-PRIV-2, FR-MEM-4, FR-PAY-10: every table holding household or user data is
-- registered for export (this test fails for a new table that isn't); only a parent exports
-- the household; any member exports their own account; no household's data reaches another;
-- secrets and deleted rows are left out; Free households export too.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ---------------------------------------------------------------------------
-- Coverage, the same rules as data_deletion.test.sql
-- ---------------------------------------------------------------------------
select is(
  array(
    select c.table_name::text from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'household_id'
      and not exists (
        select 1 from private.export_registry r
        where r.table_name = format('public.%I', c.table_name)::regclass)
    order by 1),
  array[]::text[],
  'every public table with a household_id is registered for export (or says why not)');

select is(
  array(
    select distinct con.conrelid::regclass::text
    from pg_constraint con
    join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = con.conrelid)
    where con.contype = 'f' and n.nspname = 'public'
      and con.confrelid in ('auth.users'::regclass, 'public.households'::regclass)
      and not exists (select 1 from private.export_registry r where r.table_name = con.conrelid)
    order by 1),
  array[]::text[],
  'every table with a foreign key to auth.users or households is registered for export');

select is(
  array(
    select distinct format('public.%s', c.table_name) from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type = 'uuid'
      and (c.column_name like '%\_by' or c.column_name like '%user\_id')
      and not exists (
        select 1 from private.export_registry r
        where r.table_name = format('public.%I', c.table_name)::regclass)
    order by 1),
  array[]::text[],
  'every table with a user column is registered for export');

select ok(
  (select bool_and(reason is not null) from private.export_registry where scope = 'none'),
  'every table left out of export says why');

select is(
  array(select r.table_name::text from private.export_registry r
        where r.table_name in ('public.recipes'::regclass, 'public.plan_entries'::regclass,
          'public.grocery_items'::regclass, 'public.pantry_items'::regclass,
          'public.purchase_events'::regclass) and r.scope = 'household' order by 1),
  array['grocery_items', 'pantry_items', 'plan_entries', 'purchase_events', 'recipes'],
  'recipes, plans, lists, pantry and purchase history are in the household export (FR-PRIV-2)');

-- ---------------------------------------------------------------------------
-- Fixtures: household A (Free: parent, family member), household B (parent)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'UTC', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');
update public.profiles set display_name = 'Sam' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.recipes (id, household_id, title, content_locale) values
  ('aaaaaaaa-3333-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Soup', 'en-US'),
  ('aaaaaaaa-3333-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Gone', 'en-US'),
  ('bbbbbbbb-3333-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Secret', 'en-GB');
update public.recipes set deleted_at = now() where id = 'aaaaaaaa-3333-0000-0000-000000000002';
insert into public.invitations (household_id, role, invited_by, token_hash, expires_at) values
  ('00000000-0000-0000-0000-00000000000a', 'parent', 'aaaaaaaa-0000-0000-0000-000000000001',
   'not-for-export', now() + interval '1 day');

-- ---------------------------------------------------------------------------
-- Household export: parents only, their own household only
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
create temporary table a_export as
  select public.export_household_data('00000000-0000-0000-0000-00000000000a') as data;
grant select on a_export to authenticated;

select ok(
  (select (data -> 'tables') ?& array['households', 'household_members', 'member_names',
     'household_people', 'person_dietary', 'recipes', 'recipe_ingredients', 'recipe_steps',
     'plan_entries', 'plan_entry_portions', 'pantry_items', 'grocery_lists', 'grocery_items',
     'grocery_item_sources', 'purchase_events', 'invitations'] from a_export),
  'the household export has every data type in FR-PRIV-2');
select is(
  (select jsonb_path_query_array(data, '$.tables.recipes[*].title') from a_export),
  '["Soup"]'::jsonb,
  'it has the household''s live recipes only: none deleted, none from another household');
select is(
  (select data #>> '{tables,households,0,name}' from a_export),
  'Household A', 'it has the household itself');
select is(
  (select jsonb_array_length(data #> '{tables,member_names}') from a_export),
  2, 'it names both members');
select ok(
  (select not (data #> '{tables,invitations,0}' ? 'token_hash') from a_export),
  'invitation secrets are left out');
select ok(
  (select (data #> '{tables,pantry_items}') @> '[{"status": "staple"}]' from a_export),
  'the default staples are in the export');
select is(
  (select data ->> 'scope' from a_export), 'household', 'the export says what it covers');

select throws_ok(
  $$select public.export_household_data('00000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'a parent cannot export another household');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.export_household_data('00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'a family member cannot export the household (spec 2.2, row 35)');

-- ---------------------------------------------------------------------------
-- Account export: anyone, their own rows only
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_path_query_array(public.export_account_data(), '$.tables.profiles[*].id')),
  '["aaaaaaaa-0000-0000-0000-000000000002"]'::jsonb,
  'a member exports their own profile');
select is(
  (select jsonb_path_query_array(public.export_account_data(), '$.tables.household_members[*].role')),
  '["family"]'::jsonb,
  'and their own membership only');
select ok(
  (select not (public.export_account_data() -> 'tables' ? 'recipes')),
  'the account export holds no household tables');

reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.export_account_data()$$, '42501', null,
  'signed-out callers get nothing');
set local role anon;
select throws_ok($$select public.export_account_data()$$, '42501', null,
  'anon cannot call the export');
reset role;

-- A registered table needs the key column it names.
select throws_ok(
  $$select private.register_for_export('public.units', 'household', 'household_id')$$,
  'P0001', null, 'registering a table without its key column fails');

select * from finish();
rollback;
