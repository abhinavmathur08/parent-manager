-- R-01.1, NFR-SEC-2: units and store sections are read-only reference data with the
-- R-ING-2 factors; catalog ingredients are readable by everyone and writable by no client;
-- a household's own ingredients and their names are isolated per household for every role.
begin;
create extension if not exists pgtap with schema extensions;

select plan(51);

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
  b_ingredient constant text := 'ingredient.h.bbbbbbbb000000000000000000000001';
begin
  return next is_empty(
    format('select id from public.ingredients where household_id = %L', b),
    label || ': cannot read household B ingredients');
  return next is_empty(
    format('update public.ingredients set section_id = %L where household_id = %L returning id', 'section.other', b),
    label || ': cannot edit household B ingredients');
  return next throws_ok(
    format($q$insert into public.ingredients (id, household_id, default_dimension)
      values ('ingredient.h.bbbbbbbb0000000000000000000000ff', %L, 'count')$q$, b), '42501', null,
    label || ': cannot add ingredients to household B');
  return next throws_ok(
    format('delete from public.ingredients where household_id = %L', b), '42501', null,
    label || ': cannot delete household B ingredients');
  return next is_empty(
    format('select name from public.ingredient_names where household_id = %L', b),
    label || ': cannot read household B ingredient names');
  return next is_empty(
    format('update public.ingredient_names set name = %L where household_id = %L returning name', 'x', b),
    label || ': cannot rename household B ingredients');
  return next throws_ok(
    format($q$insert into public.ingredient_names (ingredient_id, locale, household_id, name)
      values (%L, 'en-US', %L, 'x')$q$, b_ingredient, b), '42501', null,
    label || ': cannot name household B ingredients');
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
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

-- A catalog item of the test's own, so the test doesn't depend on the seed.
insert into public.ingredients (id, default_dimension, section_id, allergen_codes) values
  ('ingredient.test_milk', 'volume', 'section.dairy', '{allergen.milk}');
insert into public.ingredient_names (ingredient_id, locale, name, synonyms) values
  ('ingredient.test_milk', 'en-US', 'test milk', '{}');

insert into public.ingredients (id, household_id, default_dimension, section_id) values
  ('ingredient.h.aaaaaaaa000000000000000000000001', '00000000-0000-0000-0000-00000000000a', 'count', 'section.other'),
  ('ingredient.h.bbbbbbbb000000000000000000000001', '00000000-0000-0000-0000-00000000000b', 'count', 'section.other');
insert into public.ingredient_names (ingredient_id, locale, household_id, name) values
  ('ingredient.h.aaaaaaaa000000000000000000000001', 'en-US', '00000000-0000-0000-0000-00000000000a', 'Grandma''s chutney'),
  ('ingredient.h.bbbbbbbb000000000000000000000001', 'en-AU', '00000000-0000-0000-0000-00000000000b', 'Nan''s relish');

-- ---------------------------------------------------------------------------
-- Structure: regional units are separate IDs with the R-ING-2 factors
-- ---------------------------------------------------------------------------
select results_eq(
  $$select id, round(to_base, 3) from public.units
    where id in ('unit.tsp_us', 'unit.tbsp_us', 'unit.cup_us', 'unit.tsp_metric', 'unit.tbsp_metric',
      'unit.tbsp_au', 'unit.cup_metric', 'unit.floz_us', 'unit.pint_us', 'unit.pint_imperial',
      'unit.oz', 'unit.lb')
    order by id$$,
  $$values ('unit.cup_metric', 250.000), ('unit.cup_us', 236.588), ('unit.floz_us', 29.574),
    ('unit.lb', 453.592), ('unit.oz', 28.350), ('unit.pint_imperial', 568.261),
    ('unit.pint_us', 473.176), ('unit.tbsp_au', 20.000), ('unit.tbsp_metric', 15.000),
    ('unit.tbsp_us', 14.787), ('unit.tsp_metric', 5.000), ('unit.tsp_us', 4.929)$$,
  'regional units are separate IDs with the R-ING-2 factors');
select results_eq(
  $$select dimension, count(*)::int from public.units where to_base = 1 group by dimension order by 1$$,
  $$values ('count', 1), ('mass', 1), ('volume', 1)$$,
  'each dimension has one base unit: g, ml and each');
select is_empty(
  $$select id from public.units where to_base is null and id not in ('unit.pinch', 'unit.dash')$$,
  'only a pinch and a dash have no base conversion (R-ING-5)');
select results_eq(
  'select id from public.store_sections order by default_order',
  $$values ('section.produce'), ('section.bakery'), ('section.meat'), ('section.seafood'),
    ('section.deli'), ('section.dairy'), ('section.frozen'), ('section.pantry'), ('section.baking'),
    ('section.spices'), ('section.condiments'), ('section.canned'), ('section.international'),
    ('section.breakfast'), ('section.snacks'), ('section.drinks'), ('section.baby'),
    ('section.household'), ('section.other')$$,
  'store sections match SECTION_IDS in src/features/ingredients/catalog-ids.ts');
select hasnt_column('public', 'units', 'name', 'unit names live in the locale files, not the database');
select hasnt_column('public', 'store_sections', 'name', 'section names live in the locale files');
select throws_ok(
  $$insert into public.ingredients (id, default_dimension, allergen_codes)
    values ('ingredient.bad_allergen', 'count', '{allergen.nuts}')$$,
  '23514', null, 'allergen codes are fixed identifiers');
select throws_ok(
  $$insert into public.ingredients (id, default_dimension) values ('ingredient.Milk Whole', 'count')$$,
  '23514', null, 'catalog IDs are language-neutral slugs');
select throws_ok(
  $$insert into public.ingredients (id, household_id, default_dimension)
    values ('ingredient.chutney', '00000000-0000-0000-0000-00000000000a', 'count')$$,
  '23514', null, 'a household ingredient cannot take a catalog-style ID');
select throws_ok(
  $$insert into public.ingredients (id, household_id, default_dimension, is_default_staple)
    values ('ingredient.h.aaaaaaaa0000000000000000000000ee', '00000000-0000-0000-0000-00000000000a', 'count', true)$$,
  '23514', null, 'only catalog items can be default staples');

-- ---------------------------------------------------------------------------
-- Anonymous: reads the catalog and reference data only
-- ---------------------------------------------------------------------------
select tests.as_anon();
select isnt_empty('select id from public.units', 'anon: can read units');
select isnt_empty('select id from public.store_sections', 'anon: can read store sections');
select results_eq(
  $$select id from public.ingredients where id = 'ingredient.test_milk'$$,
  array['ingredient.test_milk'], 'anon: can read catalog ingredients');
select isnt_empty(
  $$select name from public.ingredient_names where ingredient_id = 'ingredient.test_milk'$$,
  'anon: can read catalog names');
select is_empty(
  'select id from public.ingredients where household_id is not null', 'anon: cannot read household ingredients');
select is_empty(
  'select name from public.ingredient_names where household_id is not null', 'anon: cannot read household names');
select throws_ok(
  $$insert into public.units (id, dimension, to_base, systems) values ('unit.x', 'mass', 1, '{metric}')$$,
  '42501', null, 'anon: cannot add units');
select throws_ok(
  $$insert into public.ingredients (id, default_dimension) values ('ingredient.anon', 'count')$$,
  '42501', null, 'anon: cannot add catalog ingredients');
reset role;

-- ---------------------------------------------------------------------------
-- Parent of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select * from tests.cannot_reach_household_b('parent');
select results_eq(
  'select count(*)::int from public.ingredients where household_id is not null', array[1],
  'parent: sees household A''s own ingredients only');
select isnt_empty(
  $$select id from public.ingredients where id = 'ingredient.test_milk'$$, 'parent: sees the catalog');
select throws_ok(
  $$update public.units set to_base = 21 where id = 'unit.tbsp_au'$$, '42501', null,
  'parent: cannot change a unit');
select throws_ok(
  $$update public.store_sections set default_order = 1 where id = 'section.other'$$, '42501', null,
  'parent: cannot reorder store sections');
select is_empty(
  $$update public.ingredients set section_id = 'section.other' where id = 'ingredient.test_milk' returning id$$,
  'parent: cannot edit a catalog ingredient');
select throws_ok(
  $$insert into public.ingredients (id, default_dimension) values ('ingredient.sneaky', 'count')$$,
  '42501', null, 'parent: cannot add a catalog ingredient');
select is_empty(
  $$update public.ingredient_names set name = 'x' where ingredient_id = 'ingredient.test_milk' returning name$$,
  'parent: cannot rename a catalog ingredient');
select throws_ok(
  $$insert into public.ingredient_names (ingredient_id, locale, name) values ('ingredient.test_milk', 'en-GB', 'x')$$,
  '42501', null, 'parent: cannot add catalog names');
select lives_ok(
  $$insert into public.ingredients (id, household_id, default_dimension, section_id, allergen_codes)
    values ('ingredient.h.aaaaaaaa000000000000000000000002', '00000000-0000-0000-0000-00000000000a',
      'mass', 'section.international', '{allergen.sesame}')$$,
  'parent: can add a household ingredient');
select lives_ok(
  $$insert into public.ingredient_names (ingredient_id, locale, household_id, name, synonyms)
    values ('ingredient.h.aaaaaaaa000000000000000000000002', 'en-US', '00000000-0000-0000-0000-00000000000a',
      'Za''atar blend', '{zaatar}')$$,
  'parent: can name it');
select throws_ok(
  $$insert into public.ingredient_names (ingredient_id, locale, household_id, name)
    values ('ingredient.h.aaaaaaaa000000000000000000000002', 'en-GB', null, 'x')$$,
  '23514', null, 'parent: cannot pass a household name off as a catalog name');
select throws_ok(
  $$update public.ingredients set household_id = '00000000-0000-0000-0000-00000000000b'
    where id = 'ingredient.h.aaaaaaaa000000000000000000000002'$$,
  '23514', null, 'parent: cannot move an ingredient to household B');
select lives_ok(
  $$update public.ingredients set deleted_at = now() where id = 'ingredient.h.aaaaaaaa000000000000000000000002'$$,
  'parent: can remove a household ingredient (soft delete)');

-- ---------------------------------------------------------------------------
-- Family member of household A
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select * from tests.cannot_reach_household_b('family');
select lives_ok(
  $$update public.ingredient_names set synonyms = '{chutney}'
    where ingredient_id = 'ingredient.h.aaaaaaaa000000000000000000000001'$$,
  'family: can edit a household ingredient''s names');

-- ---------------------------------------------------------------------------
-- Caregiver of household A: reads, but can't write ingredients (spec section 2.2)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select results_eq(
  'select count(*)::int from public.ingredients where household_id is not null', array[2],
  'caregiver: sees household A''s own ingredients');
select throws_ok(
  $$insert into public.ingredients (id, household_id, default_dimension)
    values ('ingredient.h.aaaaaaaa000000000000000000000003', '00000000-0000-0000-0000-00000000000a', 'count')$$,
  '42501', null, 'caregiver: cannot add a household ingredient');
reset role;

-- The trigger refuses a name whose household doesn't match its ingredient's.
select throws_ok(
  $$insert into public.ingredient_names (ingredient_id, locale, household_id, name)
    values ('ingredient.h.bbbbbbbb000000000000000000000001', 'en-US', '00000000-0000-0000-0000-00000000000a', 'x')$$,
  '23514', null, 'a name''s household must match its ingredient''s');

-- ---------------------------------------------------------------------------
-- Parent of household B
-- ---------------------------------------------------------------------------
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select results_eq(
  'select name from public.ingredient_names where household_id is not null', array['Nan''s relish'],
  'household B parent: sees only household B''s names');
select is_empty(
  $$select id from public.ingredients where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'household B parent: cannot read household A ingredients');
reset role;

select * from finish();
rollback;
