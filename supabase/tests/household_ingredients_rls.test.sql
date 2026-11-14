-- R-02.2, FR-REC-5, R-ING-1, NFR-SEC-2: household_ingredients is isolated per household for
-- every role; caregivers read but can't write; each row is published to `ingredients` and
-- `ingredient_names` with the `ingredient.h.<hex>` ID, so recipe lines can use it at once.
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

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

insert into public.household_ingredients (id, household_id, name, locale, section_id, default_dimension) values
  ('bbbbbbbb-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'Grandma''s chutney', 'en-GB', 'section.condiments', 'mass');

-- ---------------------------------------------------------------------------
-- A parent adds an ingredient; it's published with its household ID
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.household_ingredients (id, household_id, name, locale, section_id, default_dimension)
    values ('aaaaaaaa-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
            ' Za''atar blend ', 'en-US', 'section.spices', 'mass')$$,
  'a parent adds a household ingredient');
select results_eq(
  $$select household_id, default_dimension, section_id from public.ingredients
    where id = 'ingredient.h.aaaaaaaa444400000000000000000001'$$,
  $$values ('00000000-0000-0000-0000-00000000000a'::uuid, 'mass'::text, 'section.spices'::text)$$,
  'the ingredient is published with the ingredient.h.<hex> ID');
select is(
  (select name from public.ingredient_names
   where ingredient_id = 'ingredient.h.aaaaaaaa444400000000000000000001' and locale = 'en-US'),
  'Za''atar blend', 'its name is published in the household''s locale, trimmed');
select is(
  (select version from public.household_ingredients where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
  1, 'the row syncs: the server sets the version');

-- A recipe line can use it straight away (R-ING-1).
insert into public.recipes (id, household_id, title, content_locale) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Flatbread', 'en-US');
select lives_ok(
  $$insert into public.recipe_ingredients (id, household_id, recipe_id, position, ingredient_id, quantity, unit_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-000000000001',
            0, 'ingredient.h.aaaaaaaa444400000000000000000001', 2, 'unit.tbsp_us')$$,
  'a recipe line uses the new ingredient');

-- Renaming and removing follow through.
update public.household_ingredients set name = 'Za''atar', version = 1
where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select is(
  (select name from public.ingredient_names
   where ingredient_id = 'ingredient.h.aaaaaaaa444400000000000000000001'),
  'Za''atar', 'a rename is published');
update public.household_ingredients set deleted_at = now(), version = 2
where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select isnt(
  (select deleted_at from public.ingredients where id = 'ingredient.h.aaaaaaaa444400000000000000000001'),
  null, 'removing it soft-deletes the ingredient');
select isnt(
  (select deleted_at from public.ingredient_names where ingredient_id = 'ingredient.h.aaaaaaaa444400000000000000000001'),
  null, 'and its name');

select throws_ok(
  $$insert into public.household_ingredients (id, household_id, name, locale)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '  ', 'en-US')$$,
  '23514', null, 'a name is required');
select throws_ok(
  $$insert into public.household_ingredients (id, household_id, name, locale, section_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Thing', 'en-US', 'section.nowhere')$$,
  '23503', null, 'the section is one of the store sections');
select throws_ok(
  $$delete from public.household_ingredients where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'household ingredients can''t be hard-deleted');

-- ---------------------------------------------------------------------------
-- Isolation (NFR-SEC-2)
-- ---------------------------------------------------------------------------
select is_empty(
  $$select id from public.household_ingredients where household_id = '00000000-0000-0000-0000-00000000000b'$$,
  'a parent can''t read household B''s ingredients');
select is_empty(
  $$update public.household_ingredients set name = 'Hacked'
    where household_id = '00000000-0000-0000-0000-00000000000b' returning id$$,
  'a parent can''t edit household B''s ingredients');
select throws_ok(
  $$insert into public.household_ingredients (id, household_id, name, locale)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'Intruder', 'en-GB')$$,
  '42501', null, 'a parent can''t add an ingredient to household B');
select is_empty(
  $$select id from public.ingredients where household_id = '00000000-0000-0000-0000-00000000000b'$$,
  'household B''s published ingredient stays hidden');
reset role;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.household_ingredients),
  1, 'a caregiver reads their household''s ingredients only');
select throws_ok(
  $$insert into public.household_ingredients (id, household_id, name, locale)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Caregiver crackers', 'en-US')$$,
  '42501', null, 'a caregiver can''t add an ingredient');
select is_empty(
  $$update public.household_ingredients set name = 'Changed' returning id$$,
  'a caregiver can''t edit an ingredient');
reset role;

set local role anon;
select throws_ok('select id from public.household_ingredients', '42501', null,
  'anon can''t read household ingredients');
reset role;

-- B's published row really exists, so the isolation checks above aren't vacuous.
select is(
  (select count(*)::int from public.ingredients where id = 'ingredient.h.bbbbbbbb444400000000000000000001'),
  1, 'household B''s ingredient was published');

select * from finish();
rollback;
