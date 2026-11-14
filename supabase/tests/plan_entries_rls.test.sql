-- P-01.1, FR-PLAN-4 to FR-PLAN-6, FR-PLAN-11, NFR-SEC-2: plan_entries and plan_entry_portions
-- are isolated per household for every role; caregivers read but can't write; recipes,
-- leftover links, people and portions stay inside the entry's household; a delete wins over
-- a later move; removing an entry removes its portions as tombstones.
begin;
create extension if not exists pgtap with schema extensions;

select plan(47);

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

-- Every read and write a member of household A might try against household B.
create function tests.cannot_reach_household_b(label text)
returns setof text language plpgsql as $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  b_entry constant uuid := 'bbbbbbbb-4444-0000-0000-000000000001';
  b_person constant uuid := 'bbbbbbbb-5555-0000-0000-000000000001';
begin
  return next is_empty(
    format('select id from public.plan_entries where household_id = %L', b),
    label || ': cannot read household B''s plan');
  return next is_empty(
    format('select id from public.plan_entry_portions where household_id = %L', b),
    label || ': cannot read household B''s portions');
  return next is_empty(
    format('update public.plan_entries set slot = %L where household_id = %L returning id', 'lunch', b),
    label || ': cannot move household B''s entries');
  return next is_empty(
    format('update public.plan_entries set deleted_at = now() where household_id = %L returning id', b),
    label || ': cannot remove household B''s entries');
  return next is_empty(
    format('update public.plan_entry_portions set portions = 2 where household_id = %L returning id', b),
    label || ': cannot change household B''s portions');
  return next throws_ok(
    format($q$insert into public.plan_entries (id, household_id, date, slot, free_text, servings)
      values (gen_random_uuid(), %L, '2026-11-16', 'dinner', 'Intruder', 2)$q$, b), '42501', null,
    label || ': cannot add an entry to household B');
  return next throws_ok(
    format($q$insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions)
      values (gen_random_uuid(), %L, %L, %L, 1)$q$, b, b_entry, b_person), '42501', null,
    label || ': cannot set a portion in household B');
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
  ('aaaaaaaa-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Alex', 'adult', 'adult'),
  ('aaaaaaaa-5555-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Baby', 'child', 'infant_6_12m'),
  ('bbbbbbbb-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Sam', 'adult', 'adult');

insert into public.recipes (id, household_id, title, content_locale) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Chili', 'en-US'),
  ('bbbbbbbb-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Shepherd''s pie', 'en-GB');

insert into public.plan_entries (id, household_id, date, slot, recipe_id, servings) values
  ('bbbbbbbb-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   '2026-11-16', 'dinner', 'bbbbbbbb-1111-0000-0000-000000000001', 2);
insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions) values
  ('bbbbbbbb-6666-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'bbbbbbbb-4444-0000-0000-000000000001', 'bbbbbbbb-5555-0000-0000-000000000001', 1);

-- ---------------------------------------------------------------------------
-- Structure and sync rules (FR-PLAN-11)
-- ---------------------------------------------------------------------------
select has_trigger('public', 'plan_entries', 'sync_before_update', 'plan entries sync');
select has_trigger('public', 'plan_entry_portions', 'sync_before_update', 'portions sync');
select col_type_is('public', 'plan_entries', 'date', 'date', 'an entry belongs to a calendar date, not a moment');

-- ---------------------------------------------------------------------------
-- A parent plans (FR-PLAN-3, FR-PLAN-4)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, recipe_id, servings)
    values ('aaaaaaaa-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
            '2026-11-16', 'dinner', 'aaaaaaaa-1111-0000-0000-000000000001', 2.5)$$,
  'a parent adds a recipe to a slot');
select is(
  (select version from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
  1, 'the server sets the first version');
select lives_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, position, free_text, servings)
    values ('aaaaaaaa-4444-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
            '2026-11-16', 'dinner', 1, 'Garlic bread', 2)$$,
  'a slot holds more than one entry, and free text is allowed');
select throws_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, servings)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'dinner', 2)$$,
  '23514', null, 'an entry needs a recipe or free text');
select throws_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, free_text, servings)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'brunch', 'Eggs', 2)$$,
  '23514', null, 'the slot is one of the five');
select throws_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, free_text, servings)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'lunch', 'Soup', 1.3)$$,
  '23514', null, 'servings go in quarter steps');
select throws_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, free_text, servings)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'lunch', 'Soup', 0)$$,
  '23514', null, 'servings are above 0');
select throws_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, recipe_id, servings)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'lunch',
            'bbbbbbbb-1111-0000-0000-000000000001', 2)$$,
  '23514', null, 'an entry can''t use another household''s recipe');
select throws_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, free_text, servings, leftover_of_entry_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-11-17', 'lunch', 'Leftovers', 2,
            'bbbbbbbb-4444-0000-0000-000000000001')$$,
  '23514', null, 'an entry can''t be leftovers of another household''s entry');
select lives_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, recipe_id, servings, leftover_of_entry_id)
    values ('aaaaaaaa-4444-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
            '2026-11-17', 'lunch', 'aaaaaaaa-1111-0000-0000-000000000001', 2,
            'aaaaaaaa-4444-0000-0000-000000000001')$$,
  'an entry can be leftovers of an entry in its own household');

-- ---------------------------------------------------------------------------
-- Portions per person (FR-PLAN-6)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions, variant) values
    ('aaaaaaaa-6666-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000001', 2, 'standard'),
    ('aaaaaaaa-6666-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000002', 0.25, 'baby_plate')$$,
  'a parent sets portions, including a baby plate');
select throws_ok(
  $$insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000001', 1)$$,
  '23505', null, 'a person has one portion row per entry');
select throws_ok(
  $$insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-5555-0000-0000-000000000001', 1.5)$$,
  '23514', null, 'a portion is 0, ½, 1 or 2');
select throws_ok(
  $$insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions, variant)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-5555-0000-0000-000000000002', 0.5, 'baby_plate')$$,
  '23514', null, 'a baby plate is always ¼');
select throws_ok(
  $$insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-4444-0000-0000-000000000002', 'bbbbbbbb-5555-0000-0000-000000000001', 1)$$,
  '23514', null, 'a portion can''t name another household''s person');
select throws_ok(
  $$update public.plan_entry_portions set entry_id = 'aaaaaaaa-4444-0000-0000-000000000002', version = 1
    where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
  '23514', null, 'a portion can''t move to another entry');

select throws_ok(
  $$delete from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000002'$$,
  '42501', null, 'entries can''t be hard-deleted');

-- ---------------------------------------------------------------------------
-- A family member edits; a caregiver only reads (spec 2.2, rows 19 to 21)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select isnt_empty(
  $$update public.plan_entries set date = '2026-11-18', slot = 'lunch', version = 1
    where id = 'aaaaaaaa-4444-0000-0000-000000000002' returning id$$,
  'a family member moves an entry');
select isnt_empty(
  $$update public.plan_entry_portions set portions = 1, version = 1
    where id = 'aaaaaaaa-6666-0000-0000-000000000001' returning id$$,
  'a family member changes a portion');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.plan_entries), 3,
  'a caregiver reads the plan, and only their own household''s');
select is(
  (select count(*)::int from public.plan_entry_portions), 2, 'a caregiver reads portions');
select throws_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, free_text, servings)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-11-19', 'dinner', 'Pizza', 2)$$,
  '42501', null, 'a caregiver can''t add an entry');
select is_empty(
  $$update public.plan_entries set slot = 'snack' where household_id = '00000000-0000-0000-0000-00000000000a' returning id$$,
  'a caregiver can''t move entries');
select is_empty(
  $$update public.plan_entry_portions set portions = 0 where household_id = '00000000-0000-0000-0000-00000000000a' returning id$$,
  'a caregiver can''t change portions');
reset role;

-- ---------------------------------------------------------------------------
-- Isolation (NFR-SEC-2): every role in household A, against household B
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select * from tests.cannot_reach_household_b('parent');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select * from tests.cannot_reach_household_b('family');
reset role;

set local role anon;
select throws_ok('select id from public.plan_entries', '42501', null, 'anon can''t read the plan');
reset role;

-- ---------------------------------------------------------------------------
-- Removing: tombstones, portions follow, and a delete wins over a late move (spec 3.6)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.plan_entries set deleted_at = now(), version = 1
where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select is(
  (select count(*)::int from public.plan_entry_portions
   where entry_id = 'aaaaaaaa-4444-0000-0000-000000000001' and deleted_at is null),
  0, 'removing an entry removes its portions');
select is(
  (select min(version) from public.plan_entry_portions where entry_id = 'aaaaaaaa-4444-0000-0000-000000000001'),
  2, 'the portion tombstones get new versions, so they sync');

-- The partner's move was made offline, based on the version before the delete.
update public.plan_entries set date = '2026-11-20', deleted_at = null, version = 1
where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select isnt(
  (select deleted_at from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
  null, 'a late move doesn''t bring a removed entry back');
select is(
  (select date from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
  '2026-11-16'::date, 'the removed entry keeps its date');

update public.plan_entries set deleted_at = now(), version = 1
where id = 'aaaaaaaa-4444-0000-0000-000000000003';
insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions) values
  ('aaaaaaaa-6666-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-4444-0000-0000-000000000003', 'aaaaaaaa-5555-0000-0000-000000000001', 1);
select isnt(
  (select deleted_at from public.plan_entry_portions where id = 'aaaaaaaa-6666-0000-0000-000000000003'),
  null, 'a portion set offline on a removed entry arrives deleted');
reset role;

select * from finish();
rollback;
