-- H-04.2: leaving a household (FR-HH-8, FR-HH-14) and membership_status() for S-35.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- A (Free): parent P1, caregiver C (paused on Free), removed family member R.
-- B: parent Q alone, with a recipe-like row (a pantry item) to show deletion cascades.
-- D: parents D1 and D2.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'p1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'c@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'r@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'q@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000001', 'd1@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000002', 'd2@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'none@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1),
  ('00000000-0000-0000-0000-00000000000d', 'Household D', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1);

insert into public.household_members (household_id, user_id, role, status) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent', 'active'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver', 'active'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'family', 'removed'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent', 'active'),
  ('00000000-0000-0000-0000-00000000000d', 'dddddddd-0000-0000-0000-000000000001', 'parent', 'active'),
  ('00000000-0000-0000-0000-00000000000d', 'dddddddd-0000-0000-0000-000000000002', 'parent', 'active');

-- membership_status
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(public.membership_status() ->> 'status', 'member', 'a parent is a member');
select is(public.membership_status() ->> 'only_member', 'false', 'with others in the household');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(public.membership_status() ->> 'status', 'paused',
  'a caregiver on a free household is paused');
select is(public.membership_status() ->> 'household_name', 'Household A',
  'a paused member is told which household');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select is(public.membership_status() ->> 'status', 'removed', 'a removed member is told so');
reset role;
select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select is(public.membership_status(), '{"status": "none"}'::jsonb,
  'someone with no household has none');
select throws_ok(
  $$select public.leave_household('00000000-0000-0000-0000-00000000000a')$$,
  'P0002', null, 'someone outside cannot leave a household');
reset role;
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(public.membership_status() ->> 'only_member', 'true', 'a sole member is told so');
select throws_ok(
  $$select public.leave_household('00000000-0000-0000-0000-00000000000a')$$,
  'P0002', null, 'a member of another household cannot leave household A');
reset role;

-- The last parent with others left (FR-HH-14)
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.leave_household('00000000-0000-0000-0000-00000000000a')$$,
  'P0001', 'the household needs a parent',
  'the last parent cannot leave while others remain, even paused ones');
reset role;

-- A paused member can leave.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(public.leave_household('00000000-0000-0000-0000-00000000000a'), '{"deleted": false}'::jsonb,
  'a paused caregiver can leave');
select is(public.membership_status(), '{"status": "none"}'::jsonb,
  'someone who left has no household and is not shown as removed');
reset role;

-- One of two parents leaves.
select tests.as_user('dddddddd-0000-0000-0000-000000000002');
select is(public.leave_household('00000000-0000-0000-0000-00000000000d') ->> 'deleted', 'false',
  'one of two parents can leave');
select is_empty(
  $$select id from public.households where id = '00000000-0000-0000-0000-00000000000d'$$,
  'after leaving they cannot read the household');
reset role;
select is(
  (select status from public.household_members
   where user_id = 'dddddddd-0000-0000-0000-000000000002'),
  'left', 'leaving is recorded as left');

-- The only member leaves: the household is deleted (FR-HH-8).
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(public.leave_household('00000000-0000-0000-0000-00000000000b'), '{"deleted": true}'::jsonb,
  'the only member leaving deletes the household');
reset role;
select is_empty(
  $$select id from public.households where id = '00000000-0000-0000-0000-00000000000b'$$,
  'the household is gone');
select is_empty(
  $$select 1 from public.household_entitlements where household_id = '00000000-0000-0000-0000-00000000000b'$$,
  'its data cascades');

-- The last parent leaving once they are alone.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(public.leave_household('00000000-0000-0000-0000-00000000000a') ->> 'deleted', 'true',
  'the last parent can leave once alone, which deletes the household');
select is(public.membership_status(), '{"status": "none"}'::jsonb,
  'after deleting the household the parent has none');
reset role;

select * from finish();
rollback;
