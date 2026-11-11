-- H-06.3, NFR-OFF-5, architecture section 5: private.enable_sync() gives a table
-- server-set timestamps and versions, soft deletes that never come back, and check-offs a
-- stale write can't undo. Uses a throwaway table, rolled back with the test.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;


-- ---------------------------------------------------------------------------
-- Fixtures: household A with two parents, household B with one.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a2@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b1@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'UTC', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'UTC', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

create table public.sync_test_items (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by uuid,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.sync_test_items enable row level security;
grant select, insert, update, delete on public.sync_test_items to authenticated;
create policy "Members read" on public.sync_test_items for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members insert" on public.sync_test_items for insert to authenticated
  with check (private.household_role(household_id) is not null);
create policy "Members update" on public.sync_test_items for update to authenticated
  using (private.household_role(household_id) is not null)
  with check (private.household_role(household_id) is not null);

-- ---------------------------------------------------------------------------
-- enable_sync checks the table
-- ---------------------------------------------------------------------------
create table public.sync_test_missing (id uuid primary key, household_id uuid not null);
alter table public.sync_test_missing enable row level security;
select throws_ok(
  $$select private.enable_sync('public.sync_test_missing')$$, 'P0001', null,
  'enable_sync refuses a table without the system columns');

create table public.sync_test_no_rls (like public.sync_test_items);
select throws_ok(
  $$select private.enable_sync('public.sync_test_no_rls')$$, 'P0001', null,
  'enable_sync refuses a table without row-level security');

select throws_ok(
  $$select private.enable_sync('public.sync_test_items', array['name'])$$, 'P0001', null,
  'enable_sync refuses a check column that is not a boolean with _at and _by columns');

select lives_ok(
  $$select private.enable_sync('public.sync_test_items', array['checked'])$$,
  'enable_sync accepts a table with the system columns, RLS and a check column');

select ok(
  not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
  or exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and tablename = 'sync_test_items'),
  'the table is published to Realtime, where the stack has it');
select ok(
  exists (select 1 from pg_indexes where indexname = 'sync_test_items_sync_idx'),
  'the table has the pull index');

select is_empty(
  $$select 1 from information_schema.routine_privileges
    where routine_schema = 'private' and routine_name like '%sync%'
      and grantee in ('anon', 'authenticated', 'PUBLIC')$$,
  'clients cannot call the sync functions directly');

-- ---------------------------------------------------------------------------
-- Inserts: the server sets the system columns (client clocks are never trusted)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');

insert into public.sync_test_items (id, household_id, name, checked, version, created_at, updated_at)
values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'milk',
        true, 99, '2000-01-01', '2000-01-01');

select results_eq(
  $$select version, created_at > '2001-01-01', updated_at = created_at, checked,
           checked_by, checked_at = created_at
    from public.sync_test_items where id = '11111111-0000-0000-0000-000000000001'$$,
  $$values (1, true, true, true, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, true)$$,
  'an insert gets version 1, server timestamps, and who checked it');

insert into public.sync_test_items (id, household_id, name, checked_by, checked_at)
values ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'eggs',
        'bbbbbbbb-0000-0000-0000-000000000001', '2000-01-01');
select results_eq(
  $$select checked, checked_by, checked_at from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000002'$$,
  $$values (false, null::uuid, null::timestamptz)$$,
  'a client cannot claim someone else checked an item');

select throws_ok(
  $$insert into public.sync_test_items (id, household_id, name)
    values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'again')$$,
  '23505', null,
  'inserting an existing id fails, so a retried create is recognised');

-- ---------------------------------------------------------------------------
-- Updates: the version increments and the timestamp moves on
-- ---------------------------------------------------------------------------
update public.sync_test_items set name = 'oat milk', version = 1, updated_at = '2000-01-01'
where id = '11111111-0000-0000-0000-000000000001';
select is(
  (select version from public.sync_test_items where id = '11111111-0000-0000-0000-000000000001'),
  2, 'an update increments the version');
select ok(
  (select updated_at > created_at from public.sync_test_items
   where id = '11111111-0000-0000-0000-000000000001'),
  'an update sets updated_at from the server clock');

update public.sync_test_items set name = 'whole milk', version = 1
where id = '11111111-0000-0000-0000-000000000001';
select is(
  (select name from public.sync_test_items where id = '11111111-0000-0000-0000-000000000001'),
  'whole milk', 'a stale edit to an ordinary column still wins (last write wins)');

update public.sync_test_items
set household_id = '00000000-0000-0000-0000-00000000000b', created_at = '2000-01-01',
    id = '11111111-0000-0000-0000-0000000000ff'
where id = '11111111-0000-0000-0000-000000000001';
select results_eq(
  $$select household_id, created_at > '2001-01-01' from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000001'$$,
  $$values ('00000000-0000-0000-0000-00000000000a'::uuid, true)$$,
  'id, household_id and created_at cannot change');

-- ---------------------------------------------------------------------------
-- Check-offs (architecture section 5)
-- ---------------------------------------------------------------------------
-- milk is checked, at version 4 now. A stale uncheck, based on version 1, can't undo it.
update public.sync_test_items set checked = false, version = 1
where id = '11111111-0000-0000-0000-000000000001';
select results_eq(
  $$select checked, checked_by, version from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000001'$$,
  $$values (true, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 5)$$,
  'a stale uncheck does not override a newer check');

update public.sync_test_items set checked = false, version = 5
where id = '11111111-0000-0000-0000-000000000001';
select results_eq(
  $$select checked, checked_by, checked_at from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000001'$$,
  $$values (false, null::uuid, null::timestamptz)$$,
  'an uncheck based on the current version applies and clears who checked it');

reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
update public.sync_test_items set checked = true, version = 6
where id = '11111111-0000-0000-0000-000000000001';
select results_eq(
  $$select checked, checked_by from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000001'$$,
  $$values (true, 'aaaaaaaa-0000-0000-0000-000000000002'::uuid)$$,
  'a check records who checked it');

reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.sync_test_items set checked = true, version = 1
where id = '11111111-0000-0000-0000-000000000001';
select results_eq(
  $$select checked, checked_by from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000001'$$,
  $$values (true, 'aaaaaaaa-0000-0000-0000-000000000002'::uuid)$$,
  'checking an item that is already checked keeps who checked it first');

update public.sync_test_items set checked_by = 'aaaaaaaa-0000-0000-0000-000000000001',
checked_at = '2000-01-01'
where id = '11111111-0000-0000-0000-000000000001';
select results_eq(
  $$select checked_by, checked_at > '2001-01-01' from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000001'$$,
  $$values ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, true)$$,
  'clients cannot rewrite who checked an item or when');

-- ---------------------------------------------------------------------------
-- Soft deletes (tombstones)
-- ---------------------------------------------------------------------------
update public.sync_test_items set deleted_at = '2000-01-01', version = 1
where id = '11111111-0000-0000-0000-000000000002';
select results_eq(
  $$select deleted_at > '2001-01-01', version from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000002'$$,
  $$values (true, 2)$$,
  'a delete sets deleted_at from the server clock, even from a stale device');

update public.sync_test_items set name = 'edited after delete', deleted_at = null, version = 1
where id = '11111111-0000-0000-0000-000000000002';
select results_eq(
  $$select name, deleted_at is not null, version from public.sync_test_items
    where id = '11111111-0000-0000-0000-000000000002'$$,
  $$values ('eggs', true, 2)$$,
  'an edit to a deleted row changes nothing and answers with the tombstone');

select throws_ok(
  $$delete from public.sync_test_items where id = '11111111-0000-0000-0000-000000000001'$$,
  '42501', null, 'members cannot hard-delete rows');

insert into public.sync_test_items (id, household_id, name, deleted_at)
values ('11111111-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'gone',
        '2000-01-01');
select ok(
  (select deleted_at = created_at from public.sync_test_items
   where id = '11111111-0000-0000-0000-000000000003'),
  'a row created already deleted gets the server time as its delete time');

-- ---------------------------------------------------------------------------
-- Household isolation (the table's own RLS, unchanged by the sync triggers)
-- ---------------------------------------------------------------------------
reset role;
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');

select is_empty(
  $$select id from public.sync_test_items where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'another household cannot read the rows');
select is_empty(
  $$update public.sync_test_items set name = 'x', version = 1
    where household_id = '00000000-0000-0000-0000-00000000000a' returning id$$,
  'another household cannot update the rows');
select throws_ok(
  $$insert into public.sync_test_items (id, household_id, name)
    values ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'x')$$,
  '42501', null, 'another household cannot insert rows');
select throws_ok(
  $$delete from public.sync_test_items where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'another household cannot delete rows');

-- Removing a member stops their writes (NFR-OFF-6: the device discards them).
reset role;
update public.household_members set status = 'removed'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000002';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select is_empty(
  $$select id from public.sync_test_items$$, 'a removed member cannot read the rows');
select is_empty(
  $$update public.sync_test_items set name = 'x' returning id$$,
  'a removed member cannot update the rows');
select throws_ok(
  $$insert into public.sync_test_items (id, household_id, name)
    values ('22222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'x')$$,
  '42501', null, 'a removed member cannot insert rows');

select * from finish();
rollback;
