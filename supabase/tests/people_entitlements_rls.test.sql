-- H-01.2, NFR-SEC-2, NFR-SEC-4: household_people, person_dietary, household_entitlements and
-- app_config are isolated per household for every role; clients can't write entitlements;
-- children are stored by age band only; family and caregivers lose access when Premium lapses.
begin;
create extension if not exists pgtap with schema extensions;

select plan(58);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the test)
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

create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Every read and write a member of household A might try against household B.
create function tests.cannot_reach_household_b(label text)
returns setof text language plpgsql as $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  b_person constant uuid := 'bbbbbbbb-1111-0000-0000-000000000001';
begin
  return next is_empty(
    format('select id from public.household_people where household_id = %L', b),
    label || ': cannot read household B people');
  return next is_empty(
    format('update public.household_people set display_name = %L where household_id = %L returning id', 'x', b),
    label || ': cannot edit household B people');
  return next throws_ok(
    format($q$insert into public.household_people (household_id, display_name, kind, age_band)
      values (%L, 'x', 'child', 'toddler')$q$, b), '42501', null,
    label || ': cannot add people to household B');
  return next throws_ok(
    format('delete from public.household_people where household_id = %L', b), '42501', null,
    label || ': cannot delete household B people');
  return next is_empty(
    format('select id from public.person_dietary where household_id = %L', b),
    label || ': cannot read household B diets and allergies');
  return next is_empty(
    format('update public.person_dietary set deleted_at = now() where household_id = %L returning id', b),
    label || ': cannot remove household B allergies');
  return next throws_ok(
    format($q$insert into public.person_dietary (household_id, person_id, type, code)
      values (%L, %L, 'allergy', 'allergen.egg')$q$, b, b_person), '42501', null,
    label || ': cannot add household B allergies');
  return next is_empty(
    format('select household_id from public.household_entitlements where household_id = %L', b),
    label || ': cannot read household B entitlement');
  return next throws_ok(
    format($q$update public.household_entitlements set tier = 'premium' where household_id = %L$q$, b),
    '42501', null, label || ': cannot change household B entitlement');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (Premium: parent, family member, caregiver), household B (Free: parent).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

insert into public.household_people (id, household_id, display_name, kind, age_band) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Bean', 'child', 'infant_6_12m'),
  ('bbbbbbbb-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Pip', 'child', 'toddler');

insert into public.person_dietary (household_id, person_id, type, code) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-000000000001', 'allergy', 'allergen.peanut'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-1111-0000-0000-000000000001', 'allergy', 'allergen.milk');

insert into public.app_config (key, value) values ('min_app_version', '"1.0.0"');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.household_entitlements),
  2, 'every household gets an entitlement row');
select is(
  (select tier from public.household_entitlements
   where household_id = '00000000-0000-0000-0000-00000000000b'),
  'free', 'a new household starts on Free');
select is_empty(
  $$select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'household_people'
      and data_type in ('date', 'timestamp without time zone', 'timestamp with time zone')
      and column_name not in ('created_at', 'updated_at', 'deleted_at')$$,
  'household_people has no date columns, so no birth dates (NFR-SEC-4)');
select throws_ok(
  $$insert into public.household_people (household_id, display_name, kind, age_band)
    values ('00000000-0000-0000-0000-00000000000a', 'x', 'child', 'adult')$$,
  '23514', null, 'a child must have a child age band');

-- ---------------------------------------------------------------------------
-- Parent of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select * from tests.cannot_reach_household_b('parent');
select results_eq('select count(*)::int from public.household_people', array[1], 'parent: sees household A''s people');
select results_eq(
  'select tier from public.household_entitlements', array['premium'], 'parent: sees household A''s tier');
select throws_ok(
  $$update public.household_entitlements set tier = 'free'$$, '42501', null,
  'parent: cannot write the entitlement');
select throws_ok(
  $$insert into public.household_entitlements (household_id) values (gen_random_uuid())$$, '42501', null,
  'parent: cannot insert an entitlement');
select lives_ok(
  $$insert into public.household_people (household_id, display_name, kind, age_band)
    values ('00000000-0000-0000-0000-00000000000a', 'Sam', 'adult', 'adult')$$,
  'parent: can add a person');
select lives_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    values ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-000000000001', 'diet', 'diet.vegetarian')$$,
  'parent: can add a diet');
select throws_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    values ('00000000-0000-0000-0000-00000000000a', 'bbbbbbbb-1111-0000-0000-000000000001', 'allergy', 'allergen.egg')$$,
  '23514', null, 'parent: cannot attach an allergy to household B''s person through household A');
select throws_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    values ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-000000000001', 'allergy', 'Peanuts!')$$,
  '23514', null, 'parent: allergy codes must be fixed identifiers');
select throws_ok(
  $$insert into public.household_people (household_id, display_name, kind, age_band, linked_user_id)
    values ('00000000-0000-0000-0000-00000000000a', 'x', 'adult', 'adult', 'bbbbbbbb-0000-0000-0000-000000000001')$$,
  '23514', null, 'parent: cannot link a person to someone outside the household');
select throws_ok(
  $$update public.household_people set household_id = '00000000-0000-0000-0000-00000000000b'
    where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  '23514', null, 'parent: cannot move a person into household B');
select throws_ok(
  $$insert into public.app_config (key, value) values ('x', '1')$$, '42501', null,
  'parent: cannot write app config');
reset role;

-- ---------------------------------------------------------------------------
-- Family member of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select * from tests.cannot_reach_household_b('family');
select lives_ok(
  $$insert into public.household_people (household_id, display_name, kind, age_band)
    values ('00000000-0000-0000-0000-00000000000a', 'Kit', 'child', 'preschool')$$,
  'family: can add a person');
select isnt_empty(
  $$update public.person_dietary set deleted_at = now()
    where code = 'allergen.peanut' returning id$$,
  'family: can remove an allergy');
reset role;

-- ---------------------------------------------------------------------------
-- Caregiver of household A: read only
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select * from tests.cannot_reach_household_b('caregiver');
select isnt_empty('select id from public.household_people', 'caregiver: can read household A''s people');
select isnt_empty('select id from public.person_dietary', 'caregiver: can read household A''s allergies');
select throws_ok(
  $$insert into public.household_people (household_id, display_name, kind, age_band)
    values ('00000000-0000-0000-0000-00000000000a', 'x', 'child', 'toddler')$$,
  '42501', null, 'caregiver: cannot add people');
select is_empty(
  $$update public.household_people set display_name = 'x' returning id$$,
  'caregiver: cannot edit people');
select throws_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    values ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-000000000001', 'allergy', 'allergen.egg')$$,
  '42501', null, 'caregiver: cannot add allergies');
reset role;

-- ---------------------------------------------------------------------------
-- Premium lapses: family and caregiver lose access, parents keep it (FR-PAY-9).
-- ---------------------------------------------------------------------------
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select is_empty('select id from public.household_people', 'lapsed family: cannot read people');
select is_empty('select id from public.households', 'lapsed family: cannot read the household');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty('select id from public.person_dietary', 'lapsed caregiver: cannot read allergies');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select isnt_empty('select id from public.household_people', 'parent on Free: still reads people');
reset role;

-- ---------------------------------------------------------------------------
-- Not signed in
-- ---------------------------------------------------------------------------
select tests.as_anon();
select results_eq(
  $$select value #>> '{}' from public.app_config where key = 'min_app_version'$$,
  array['1.0.0'], 'anon: can read app config');
select throws_ok('select id from public.household_people', '42501', null, 'anon: cannot read people');
select throws_ok('select id from public.person_dietary', '42501', null, 'anon: cannot read diets');
select throws_ok(
  'select household_id from public.household_entitlements', '42501', null, 'anon: cannot read entitlements');
select throws_ok(
  $$insert into public.app_config (key, value) values ('x', '1')$$, '42501', null,
  'anon: cannot write app config');
reset role;

select * from finish();
rollback;
