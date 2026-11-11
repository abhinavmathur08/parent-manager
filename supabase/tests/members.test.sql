-- H-04.1: changing roles and removing members (FR-HH-10, FR-HH-14), with the seat rules and
-- isolation between households.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Household A (Premium): parent P1, parent P2, family F, caregiver C. Household B: parent Q.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'p1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'p2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'f@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'c@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'q@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set active_household_id = '00000000-0000-0000-0000-00000000000a'
where id = 'aaaaaaaa-0000-0000-0000-000000000004';

-- Permissions
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000004', 'family')$$,
  '42501', null, 'a family member cannot change roles');
select throws_ok(
  $$select public.remove_member('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000004')$$,
  '42501', null, 'a family member cannot remove members');
reset role;

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000004', 'family')$$,
  '42501', null, 'another household''s parent cannot change roles');
select throws_ok(
  $$select public.remove_member('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000004')$$,
  '42501', null, 'another household''s parent cannot remove members');
select throws_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000b',
    'aaaaaaaa-0000-0000-0000-000000000004', 'parent')$$,
  'P0002', null, 'a parent cannot change the role of someone outside their household');
reset role;

-- Seat rules
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000003', 'parent')$$,
  'P0001', 'the household has two parents', 'a third parent is refused');
select lives_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver')$$,
  'a parent can change a family member to a caregiver');
select lives_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000002', 'family')$$,
  'a parent can make the other parent a family member');
select throws_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000001', 'family')$$,
  'P0001', 'the household needs a parent', 'the last parent cannot step down');
select lives_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000002', 'parent')$$,
  'a family member can be promoted to parent while there is a free parent seat');
reset role;

insert into public.app_config (key, value) values ('household.premium_seats', '2')
on conflict (key) do update set value = excluded.value;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000002', 'family')$$,
  'P0001', 'no free seats', 'a parent cannot step down into a full set of Premium seats');
reset role;
update public.app_config set value = '6' where key = 'household.premium_seats';

update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.change_member_role('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000002', 'caregiver')$$,
  'P0001', 'this role needs Premium', 'family and caregiver roles need Premium');
reset role;
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

-- Removing
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.remove_member('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'P0001', 'use leave_household to leave', 'a parent cannot remove themselves');
select lives_ok(
  $$select public.remove_member('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000004')$$,
  'a parent can remove a caregiver');
select throws_ok(
  $$select public.remove_member('00000000-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000004')$$,
  'P0002', null, 'a removed member cannot be removed twice');
reset role;

select is(
  (select active_household_id from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  null, 'removing clears the member''s active household');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select is(private.household_role('00000000-0000-0000-0000-00000000000a'), null,
  'a removed member loses access at once');
select is_empty(
  $$select id from public.households where id = '00000000-0000-0000-0000-00000000000a'$$,
  'a removed member can no longer read the household');
reset role;

select * from finish();
rollback;
