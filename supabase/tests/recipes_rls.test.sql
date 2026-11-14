-- R-02.1, FR-REC-4, FR-REC-12, R-ING-3, NFR-SEC-2: recipes, recipe_ingredients and
-- recipe_steps are isolated per household for every role; caregivers read but can't write;
-- lines and steps stay with their recipe's household; the server works out quantity_base,
-- records authors, and deleting a recipe deletes its lines and steps as tombstones.
begin;
create extension if not exists pgtap with schema extensions;

select plan(45);

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
  b_recipe constant uuid := 'bbbbbbbb-1111-0000-0000-000000000001';
begin
  return next is_empty(
    format('select id from public.recipes where household_id = %L', b),
    label || ': cannot read household B''s recipes');
  return next is_empty(
    format('select id from public.recipe_ingredients where household_id = %L', b),
    label || ': cannot read household B''s recipe lines');
  return next is_empty(
    format('select id from public.recipe_steps where household_id = %L', b),
    label || ': cannot read household B''s recipe steps');
  return next is_empty(
    format('update public.recipes set title = %L where household_id = %L returning id', 'Hacked', b),
    label || ': cannot edit household B''s recipes');
  return next is_empty(
    format('update public.recipe_ingredients set deleted_at = now() where household_id = %L returning id', b),
    label || ': cannot delete household B''s recipe lines');
  return next is_empty(
    format('update public.recipe_steps set text = %L where household_id = %L returning id', 'Hacked', b),
    label || ': cannot edit household B''s recipe steps');
  return next throws_ok(
    format($q$insert into public.recipes (id, household_id, title, content_locale)
      values (gen_random_uuid(), %L, 'Intruder', 'en-GB')$q$, b), '42501', null,
    label || ': cannot add a recipe to household B');
  return next throws_ok(
    format($q$insert into public.recipe_steps (id, household_id, recipe_id, position, text)
      values (gen_random_uuid(), %L, %L, 9, 'Intruder')$q$, b, b_recipe), '42501', null,
    label || ': cannot add a step to household B''s recipe');
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

insert into public.ingredients (id, household_id, default_dimension) values
  ('ingredient.h.bbbbbbbb000000000000000000000001', '00000000-0000-0000-0000-00000000000b', 'count');

insert into public.recipes (id, household_id, title, content_locale) values
  ('bbbbbbbb-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Shepherd''s pie', 'en-GB');
insert into public.recipe_ingredients (id, household_id, recipe_id, position, ingredient_id, quantity, unit_id) values
  ('bbbbbbbb-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'bbbbbbbb-1111-0000-0000-000000000001', 0, 'ingredient.milk', 200, 'unit.ml');
insert into public.recipe_steps (id, household_id, recipe_id, position, text) values
  ('bbbbbbbb-3333-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'bbbbbbbb-1111-0000-0000-000000000001', 0, 'Bake.');

-- ---------------------------------------------------------------------------
-- Structure and sync rules (FR-REC-12)
-- ---------------------------------------------------------------------------
select has_trigger('public', 'recipes', 'sync_before_update', 'recipes sync');
select has_trigger('public', 'recipe_ingredients', 'sync_before_update', 'recipe lines sync');
select has_trigger('public', 'recipe_steps', 'sync_before_update', 'recipe steps sync');

-- ---------------------------------------------------------------------------
-- A parent writes a recipe (FR-REC-4)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.recipes (id, household_id, title, servings, prep_minutes, tags, content_locale, created_by)
    values ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
            'Overnight oats', 2, 5, '{tag.no_cook,tag.one_handed}', 'en-US',
            'bbbbbbbb-0000-0000-0000-000000000001')$$,
  'a parent adds a recipe');
select is(
  (select created_by from public.recipes where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the server records who created it, whatever the client says');
select is(
  (select version from public.recipes where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  1, 'the server sets the first version');

select throws_ok(
  $$insert into public.recipes (id, household_id, title, content_locale)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '   ', 'en-US')$$,
  '23514', null, 'a title is required');
select throws_ok(
  $$insert into public.recipes (id, household_id, title, content_locale)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', repeat('x', 121), 'en-US')$$,
  '23514', null, 'a title has at most 120 characters');
select throws_ok(
  $$insert into public.recipes (id, household_id, title, servings, content_locale)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Feast', 25, 'en-US')$$,
  '23514', null, 'servings are 1 to 24');
select throws_ok(
  $$insert into public.recipes (id, household_id, title, tags, content_locale)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Tagged', '{tag.spicy}', 'en-US')$$,
  '23514', null, 'tags come from the fixed set (FR-REC-7)');
select throws_ok(
  $$insert into public.recipes (id, household_id, title, content_locale, source_type)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Copied', 'en-US', 'library')$$,
  '23514', null, 'a library copy names its starter recipe (FR-REC-3)');
select is(
  (select servings from public.recipes where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  2::smallint, 'servings are kept');

-- Ingredient lines and quantity_base (R-ING-3, R-ING-4, R-ING-5)
insert into public.recipe_ingredients (id, household_id, recipe_id, position, ingredient_id, quantity, unit_id) values
  ('aaaaaaaa-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 0, 'ingredient.milk', 1.5, 'unit.cup_us'),
  ('aaaaaaaa-2222-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 1, 'ingredient.onion', 2, null),
  ('aaaaaaaa-2222-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 2, 'ingredient.salt', null, null),
  ('aaaaaaaa-2222-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 3, 'ingredient.black_pepper', 1, 'unit.pinch'),
  ('aaaaaaaa-2222-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 4, 'ingredient.flour', 200, null);

select is(
  (select quantity_base from public.recipe_ingredients where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  354.882::numeric, '1.5 US cups is 354.882 ml');
select is(
  (select quantity_base from public.recipe_ingredients where id = 'aaaaaaaa-2222-0000-0000-000000000002'),
  2::numeric, 'a count ingredient with no unit counts each');
select is(
  (select quantity_base from public.recipe_ingredients where id = 'aaaaaaaa-2222-0000-0000-000000000003'),
  null, 'a line with no quantity has no base quantity');
select is(
  (select quantity_base from public.recipe_ingredients where id = 'aaaaaaaa-2222-0000-0000-000000000004'),
  null, 'a pinch has no base quantity');
select is(
  (select quantity_base from public.recipe_ingredients where id = 'aaaaaaaa-2222-0000-0000-000000000005'),
  null, 'a measured ingredient with no unit is "to taste"');

update public.recipe_ingredients set quantity = 2, unit_id = 'unit.tbsp_us', version = 1
where id = 'aaaaaaaa-2222-0000-0000-000000000001';
select is(
  (select quantity_base from public.recipe_ingredients where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  29.5736::numeric, 'an edit works out the base quantity again');
update public.recipe_ingredients set quantity_base = 999, version = 2
where id = 'aaaaaaaa-2222-0000-0000-000000000001';
select is(
  (select quantity_base from public.recipe_ingredients where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  29.5736::numeric, 'a client can''t set quantity_base');

select throws_ok(
  $$insert into public.recipe_ingredients (id, household_id, recipe_id, position, ingredient_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-1111-0000-0000-000000000001', 5, 'ingredient.h.bbbbbbbb000000000000000000000001')$$,
  '23514', null, 'a line can''t use another household''s ingredient');
select throws_ok(
  $$insert into public.recipe_ingredients (id, household_id, recipe_id, position, ingredient_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'bbbbbbbb-1111-0000-0000-000000000001', 0, 'ingredient.milk')$$,
  '23514', null, 'a line can''t join another household''s recipe');
select throws_ok(
  $$insert into public.recipe_steps (id, household_id, recipe_id, position, text)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'bbbbbbbb-1111-0000-0000-000000000001', 0, 'Sneak in.')$$,
  '23514', null, 'a step can''t join another household''s recipe');

insert into public.recipe_steps (id, household_id, recipe_id, position, text) values
  ('aaaaaaaa-3333-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 0, 'Stir everything together.'),
  ('aaaaaaaa-3333-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 1, 'Chill overnight.');
select is(
  (select count(*)::int from public.recipe_steps where recipe_id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  2, 'a parent adds steps');

select throws_ok(
  $$delete from public.recipes where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  '42501', null, 'recipes can''t be hard-deleted');

-- ---------------------------------------------------------------------------
-- A family member edits; a caregiver only reads
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select isnt_empty(
  $$update public.recipes set title = 'Overnight oats with berries', version = 1
    where id = 'aaaaaaaa-1111-0000-0000-000000000001' returning id$$,
  'a family member edits a recipe');
reset role;
select is(
  (select updated_by from public.recipes where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'the server records who changed it');
select is(
  (select created_by from public.recipes where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the author stays the same');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.recipe_ingredients where recipe_id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  5, 'a caregiver reads recipe lines');
select throws_ok(
  $$insert into public.recipes (id, household_id, title, content_locale)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Caregiver soup', 'en-US')$$,
  '42501', null, 'a caregiver can''t add a recipe');
select is_empty(
  $$update public.recipe_steps set text = 'Changed' where household_id = '00000000-0000-0000-0000-00000000000a' returning id$$,
  'a caregiver can''t edit steps');
select is_empty(
  $$update public.recipes set deleted_at = now() where household_id = '00000000-0000-0000-0000-00000000000a' returning id$$,
  'a caregiver can''t delete recipes');
reset role;

-- ---------------------------------------------------------------------------
-- Isolation (NFR-SEC-2): every role in household A, against household B
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select * from tests.cannot_reach_household_b('parent');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.recipes),
  1, 'a caregiver sees only their own household''s recipes');
reset role;

-- The anonymous role sees nothing.
set local role anon;
select throws_ok('select id from public.recipes', '42501', null, 'anon can''t read recipes');
reset role;

-- ---------------------------------------------------------------------------
-- Deleting a recipe tombstones its lines and steps (FR-REC-12)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.recipes set deleted_at = now(), version = 2
where id = 'aaaaaaaa-1111-0000-0000-000000000001';
select is(
  (select count(*)::int from public.recipe_ingredients
   where recipe_id = 'aaaaaaaa-1111-0000-0000-000000000001' and deleted_at is null),
  0, 'deleting a recipe deletes its lines');
select is(
  (select count(*)::int from public.recipe_steps
   where recipe_id = 'aaaaaaaa-1111-0000-0000-000000000001' and deleted_at is null),
  0, 'deleting a recipe deletes its steps');
select is(
  (select min(version) from public.recipe_steps where recipe_id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  2, 'the tombstones get new versions, so they sync');
insert into public.recipe_steps (id, household_id, recipe_id, position, text) values
  ('aaaaaaaa-3333-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 2, 'Added offline.');
select isnt(
  (select deleted_at from public.recipe_steps where id = 'aaaaaaaa-3333-0000-0000-000000000003'),
  null, 'a step added offline to a deleted recipe arrives deleted');
reset role;

select * from finish();
rollback;
