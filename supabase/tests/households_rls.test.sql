-- H-01.1, NFR-SEC-2: households, household_members, invitations and profiles are invisible
-- and unwritable across households for every role, and clients can't write membership.
begin;
create extension if not exists pgtap with schema extensions;

select plan(75);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the test)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

-- Act as a signed-in user. Call `reset role` before switching to someone else.
create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Every read and write a member of household A might try against household B.
-- Runs as whoever is signed in when it's called.
create function tests.cannot_reach_household_b(label text)
returns setof text language plpgsql as $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  b_parent constant uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
begin
  return next is_empty(
    format('select id from public.households where id = %L', b),
    label || ': cannot read household B');
  return next is_empty(
    format('update public.households set name = %L where id = %L returning id', 'x', b),
    label || ': cannot update household B');
  return next throws_ok(
    format('delete from public.households where id = %L', b), '42501', null,
    label || ': cannot delete household B');
  return next is_empty(
    format('select user_id from public.household_members where household_id = %L', b),
    label || ': cannot read household B members');
  return next throws_ok(
    format($q$insert into public.household_members (household_id, user_id, role)
      values (%L, %L, 'parent')$q$, b, auth.uid()), '42501', null,
    label || ': cannot join household B');
  return next throws_ok(
    format('delete from public.household_members where household_id = %L', b), '42501', null,
    label || ': cannot remove household B members');
  return next is_empty(
    format('select id from public.invitations where household_id = %L', b),
    label || ': cannot read household B invitations');
  return next throws_ok(
    format($q$insert into public.invitations (household_id, role, token_hash, expires_at)
      values (%L, 'parent', 'forged', now() + interval '7 days')$q$, b), '42501', null,
    label || ': cannot create household B invitations');
  return next throws_ok(
    format('update public.invitations set revoked_at = now() where household_id = %L', b),
    '42501', null, label || ': cannot revoke household B invitations');
  return next is_empty(
    format('select id from public.profiles where id = %L', b_parent),
    label || ': cannot read household B profiles');
  return next is_empty(
    format('update public.profiles set display_name = %L where id = %L returning id', 'x', b_parent),
    label || ': cannot update household B profiles');
  return next throws_ok(
    format('update public.profiles set active_household_id = %L where id = auth.uid()', b),
    '42501', null, label || ': cannot point own profile at household B');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (parent, family member, caregiver), household B (parent),
-- and an outsider with no household.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'outsider@example.test', 'authenticated', 'authenticated');

-- Fixed IDs make the assertions readable; create_household() itself is tested below.
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

insert into public.invitations (household_id, role, invited_by, token_hash, expires_at) values
  ('00000000-0000-0000-0000-00000000000a', 'parent', 'aaaaaaaa-0000-0000-0000-000000000001', 'hash-a', now() + interval '7 days'),
  ('00000000-0000-0000-0000-00000000000b', 'parent', 'bbbbbbbb-0000-0000-0000-000000000001', 'hash-b', now() + interval '7 days');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.households'::regclass, 'public.profiles'::regclass,
                 'public.household_members'::regclass, 'public.invitations'::regclass)),
  'RLS is enabled on all four tables');
select is(
  (select count(*)::int from public.profiles
   where id in (select id from auth.users where email like '%@example.test')),
  5, 'a profile is created for every new account');

-- ---------------------------------------------------------------------------
-- Parent of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select * from tests.cannot_reach_household_b('parent');
select results_eq('select count(*)::int from public.households', array[1], 'parent: sees only household A');
select results_eq('select count(*)::int from public.household_members', array[3], 'parent: sees household A''s 3 members');
select results_eq('select count(*)::int from public.invitations', array[1], 'parent: sees household A''s invitation');
select results_eq('select count(*)::int from public.profiles', array[3], 'parent: sees own and co-members'' profiles');
select isnt_empty(
  $$update public.households set name = 'Renamed' where id = '00000000-0000-0000-0000-00000000000a' returning id$$,
  'parent: can update household A');
select throws_ok(
  $$insert into public.household_members (household_id, user_id, role)
    values ('00000000-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', 'parent')$$,
  '42501', null, 'parent: cannot insert members directly, even into household A');
select throws_ok(
  $$update public.household_members set role = 'parent'
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$$,
  '42501', null, 'parent: cannot change roles directly');
select throws_ok(
  $$insert into public.invitations (household_id, role, token_hash, expires_at)
    values ('00000000-0000-0000-0000-00000000000a', 'family', 'direct', now() + interval '7 days')$$,
  '42501', null, 'parent: cannot insert invitations directly');
select throws_ok(
  $$insert into public.households (name, region, locale, unit_system, timezone, week_start)
    values ('Direct', 'US', 'en-US', 'us_customary', 'UTC', 1)$$,
  '42501', null, 'parent: cannot insert households directly');
select isnt_empty(
  $$update public.profiles set display_name = 'Alex' where id = auth.uid() returning id$$,
  'parent: can update own profile');
select is_empty(
  $$update public.profiles set display_name = 'x' where id = 'aaaaaaaa-0000-0000-0000-000000000002' returning id$$,
  'parent: cannot update a co-member''s profile');
select throws_ok(
  $$select public.create_household('Second', 'US', 'en-US', 'us_customary', 'UTC', 1::smallint)$$,
  'P0001', null, 'parent: cannot create a second household');
reset role;

-- ---------------------------------------------------------------------------
-- Family member of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select * from tests.cannot_reach_household_b('family');
select results_eq('select count(*)::int from public.households', array[1], 'family: sees household A');
select results_eq('select count(*)::int from public.household_members', array[3], 'family: sees household A''s members');
select is_empty('select id from public.invitations', 'family: cannot read invitations');
select is_empty(
  $$update public.households set name = 'x' where id = '00000000-0000-0000-0000-00000000000a' returning id$$,
  'family: cannot update household settings');
select throws_ok(
  $$update public.household_members set role = 'parent' where user_id = auth.uid()$$,
  '42501', null, 'family: cannot promote themselves');
reset role;

-- ---------------------------------------------------------------------------
-- Caregiver of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select * from tests.cannot_reach_household_b('caregiver');
select results_eq('select count(*)::int from public.households', array[1], 'caregiver: sees household A');
select is_empty('select id from public.invitations', 'caregiver: cannot read invitations');
select is_empty(
  $$update public.households set name = 'x' where id = '00000000-0000-0000-0000-00000000000a' returning id$$,
  'caregiver: cannot update household settings');
select throws_ok(
  $$update public.household_members set role = 'parent' where user_id = auth.uid()$$,
  '42501', null, 'caregiver: cannot promote themselves');
reset role;

-- ---------------------------------------------------------------------------
-- A removed member loses access immediately (FR-HH-10)
-- ---------------------------------------------------------------------------
update public.household_members set status = 'removed'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty('select id from public.households', 'removed member: cannot read their old household');
select is_empty('select user_id from public.household_members', 'removed member: cannot read members');
reset role;

-- ---------------------------------------------------------------------------
-- Signed in with no household
-- ---------------------------------------------------------------------------
select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select is_empty('select id from public.households', 'outsider: sees no households');
select is_empty('select user_id from public.household_members', 'outsider: sees no members');
select is_empty('select id from public.invitations', 'outsider: sees no invitations');
select results_eq('select count(*)::int from public.profiles', array[1], 'outsider: sees only their own profile');
select throws_ok(
  $$select public.create_household('Bad', 'US', 'en-US', 'us_customary', 'Mars/Olympus', 1::smallint)$$,
  '22023', null, 'outsider: an unknown timezone is rejected');
select lives_ok(
  $$select public.create_household('Household C', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1::smallint)$$,
  'outsider: can create a household');
select results_eq(
  $$select role from public.household_members where user_id = auth.uid()$$,
  array['parent'], 'creator: becomes the household''s parent');
select results_eq(
  $$select active_household_id is not null from public.profiles where id = auth.uid()$$,
  array[true], 'creator: the new household becomes their active household');
select throws_ok(
  $$select public.create_household('Household D', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1::smallint)$$,
  'P0001', null, 'creator: cannot create a second household');
reset role;

-- ---------------------------------------------------------------------------
-- Not signed in
-- ---------------------------------------------------------------------------
select tests.as_anon();
select throws_ok('select id from public.households', '42501', null, 'anon: cannot read households');
select throws_ok('select user_id from public.household_members', '42501', null, 'anon: cannot read members');
select throws_ok('select id from public.invitations', '42501', null, 'anon: cannot read invitations');
select throws_ok('select id from public.profiles', '42501', null, 'anon: cannot read profiles');
select throws_ok(
  $$select public.create_household('Anon', 'US', 'en-US', 'us_customary', 'UTC', 1::smallint)$$,
  '42501', null, 'anon: cannot create a household');
reset role;

select * from finish();
rollback;
