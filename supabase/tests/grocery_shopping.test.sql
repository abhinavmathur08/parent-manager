-- G-04.1, FR-LIST-8, FR-LIST-9: shopping together. Every write to a list item stamps the
-- writer in updated_by (for the "someone else is updating" banner), a client can't forge it,
-- and account deletion clears it. Check-offs keep who and when, and a stale uncheck from
-- another member can't clear a newer check.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

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
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-one@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-two@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'UTC', 7);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent');
insert into public.grocery_lists (id, household_id, week_start) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-11-15');

-- Partner one adds an item; the client's claim about the writer is ignored.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.grocery_items (id, household_id, list_id, custom_name, origin, updated_by)
values ('aaaaaaaa-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
        'aaaaaaaa-1111-0000-0000-000000000001', 'Eggs', 'manual',
        'aaaaaaaa-0000-0000-0000-000000000002');
select is(
  (select updated_by from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'adding an item stamps the writer, whatever the client sends');

-- Partner two checks it off.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
update public.grocery_items set checked = true, version = 1
where id = 'aaaaaaaa-2222-0000-0000-000000000001';
select is(
  (select updated_by from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'a check-off by the other partner stamps them');
select is(
  (select checked_by from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'the check-off records who checked it (FR-LIST-8)');
select isnt(
  (select checked_at from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  null,
  'the check-off records when (FR-LIST-8)');

-- Partner one, offline since version 1, sends a stale uncheck: the newer check stays.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.grocery_items set checked = false, version = 1, updated_by = null
where id = 'aaaaaaaa-2222-0000-0000-000000000001';
select is(
  (select checked from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  true,
  'a stale uncheck does not clear a newer check (spec 3.8, edge cases)');
select is(
  (select checked_by from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'the check keeps the member who made it');
select is(
  (select updated_by from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'the stale write still stamps its writer, and nulls are ignored');

-- Account deletion clears the member from the items that stay with the household.
reset role;
select set_config('request.jwt.claims', '', true);
select private.erase_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select updated_by from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  null,
  'account deletion clears updated_by');
select is(
  (select checked_by from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'and leaves the other partner''s check-off alone');

select * from finish();
rollback;
