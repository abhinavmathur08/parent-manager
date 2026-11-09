-- G-03.1, FR-PAN-1, FR-PAN-6, FR-ONB-6, NFR-SEC-2: a new household starts with the default
-- staples; pantry_items is isolated per household for every role; caregivers can mark
-- "have" but can't change staples; a pantry row can't use another household's ingredient.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

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
begin
  return next is_empty(
    format('select id from public.pantry_items where household_id = %L', b),
    label || ': cannot read household B''s pantry');
  return next is_empty(
    format('update public.pantry_items set deleted_at = now() where household_id = %L returning id', b),
    label || ': cannot remove household B''s staples');
  return next throws_ok(
    format($q$insert into public.pantry_items (household_id, ingredient_id, status, have_week_start)
      values (%L, 'ingredient.milk', 'have', '2026-11-09')$q$, b), '42501', null,
    label || ': cannot mark "have" in household B');
  return next throws_ok(
    format($q$insert into public.pantry_items (household_id, ingredient_id, status)
      values (%L, 'ingredient.milk', 'staple')$q$, b), '42501', null,
    label || ': cannot add staples to household B');
  return next throws_ok(
    format('delete from public.pantry_items where household_id = %L', b), '42501', null,
    label || ': cannot delete household B''s pantry');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (Premium: parent, family member, caregiver), household B (Free: parent).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'c-parent@example.test', 'authenticated', 'authenticated');

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

insert into public.ingredients (id, household_id, default_dimension) values
  ('ingredient.h.bbbbbbbb000000000000000000000001', '00000000-0000-0000-0000-00000000000b', 'count');

-- ---------------------------------------------------------------------------
-- Default staples (FR-PAN-1, FR-ONB-6)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select ingredient_id from public.pantry_items
    where household_id = '00000000-0000-0000-0000-00000000000a' order by ingredient_id$$,
  $$select id from public.ingredients
    where household_id is null and is_default_staple and deleted_at is null order by id$$,
  'a new household has the default staples');
select is(
  (select count(*)::int from public.pantry_items
   where household_id = '00000000-0000-0000-0000-00000000000a' and status <> 'staple'),
  0, 'default staples are staples, not "have" items');

-- Through onboarding's own RPC, as a signed-in user.
select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.create_household('Household C', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1::smallint)$$,
  'a user creates a household');
select results_eq(
  $$select ingredient_id from public.pantry_items order by ingredient_id$$,
  $$values ('ingredient.black_pepper'), ('ingredient.flour'), ('ingredient.salt'),
    ('ingredient.sugar'), ('ingredient.vegetable_oil'), ('ingredient.water')$$,
  'the new household''s pantry has salt, pepper, oil, flour, sugar and water');
reset role;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select hasnt_column('public', 'pantry_items', 'quantity_base', 'no quantities in Phase 1 (FR-PAN-7)');
select hasnt_column('public', 'pantry_items', 'expires_on', 'no expiry dates in Phase 1 (FR-PAN-7)');
select throws_ok(
  $$insert into public.pantry_items (household_id, ingredient_id, status)
    values ('00000000-0000-0000-0000-00000000000a', 'ingredient.milk', 'have')$$,
  '23514', null, 'a "have" needs its list week (R-PAN-2)');
select throws_ok(
  $$insert into public.pantry_items (household_id, ingredient_id, status, have_week_start)
    values ('00000000-0000-0000-0000-00000000000a', 'ingredient.cumin', 'staple', '2026-11-09')$$,
  '23514', null, 'a staple has no list week');
select throws_ok(
  $$insert into public.pantry_items (household_id, ingredient_id, status)
    values ('00000000-0000-0000-0000-00000000000a', 'ingredient.salt', 'staple')$$,
  '23505', null, 'an ingredient is a staple once');
select throws_ok(
  $$insert into public.pantry_items (household_id, ingredient_id, status)
    values ('00000000-0000-0000-0000-00000000000a', 'ingredient.h.bbbbbbbb000000000000000000000001', 'staple')$$,
  '23514', null, 'a pantry item cannot use another household''s ingredient');

-- ---------------------------------------------------------------------------
-- Parent of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select * from tests.cannot_reach_household_b('parent');
select results_eq(
  'select count(*)::int from public.pantry_items', array[6], 'parent: sees household A''s pantry only');
select lives_ok(
  $$insert into public.pantry_items (household_id, ingredient_id, status)
    values ('00000000-0000-0000-0000-00000000000a', 'ingredient.olive_oil', 'staple')$$,
  'parent: can add a staple');
select lives_ok(
  $$update public.pantry_items set status = 'hidden_staple'
    where household_id = '00000000-0000-0000-0000-00000000000a' and ingredient_id = 'ingredient.water'$$,
  'parent: can turn a staple off');
select lives_ok(
  $$insert into public.pantry_items (household_id, ingredient_id, status, have_week_start)
    values ('00000000-0000-0000-0000-00000000000a', 'ingredient.milk', 'have', '2026-11-08')$$,
  'parent: can mark "I already have this"');
select throws_ok(
  $$update public.pantry_items set household_id = '00000000-0000-0000-0000-00000000000b'
    where ingredient_id = 'ingredient.olive_oil'$$,
  '23514', null, 'parent: cannot move a pantry item to household B');

-- ---------------------------------------------------------------------------
-- Family member of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select * from tests.cannot_reach_household_b('family');
select lives_ok(
  $$update public.pantry_items set deleted_at = now()
    where household_id = '00000000-0000-0000-0000-00000000000a' and ingredient_id = 'ingredient.olive_oil'$$,
  'family: can remove a staple (soft delete)');

-- ---------------------------------------------------------------------------
-- Caregiver of household A: marks "have", but can't change staples (FR-PAN-6)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select * from tests.cannot_reach_household_b('caregiver');
select isnt_empty('select id from public.pantry_items', 'caregiver: can read the pantry');
select lives_ok(
  $$insert into public.pantry_items (household_id, ingredient_id, status, have_week_start)
    values ('00000000-0000-0000-0000-00000000000a', 'ingredient.egg', 'have', '2026-11-08')$$,
  'caregiver: can mark "I already have this"');
select lives_ok(
  $$update public.pantry_items set deleted_at = now()
    where ingredient_id = 'ingredient.egg' and status = 'have'$$,
  'caregiver: can undo a "have"');
select throws_ok(
  $$insert into public.pantry_items (household_id, ingredient_id, status)
    values ('00000000-0000-0000-0000-00000000000a', 'ingredient.cumin', 'staple')$$,
  '42501', null, 'caregiver: cannot add a staple');
select is_empty(
  $$update public.pantry_items set deleted_at = now() where status = 'staple' returning id$$,
  'caregiver: cannot remove a staple');
reset role;

select * from finish();
rollback;
