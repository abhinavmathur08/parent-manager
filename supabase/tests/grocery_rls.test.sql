-- G-01.3, FR-LIST-1, FR-LIST-8, FR-LIST-11, FR-LIST-12, FR-MEM-1, NFR-SEC-2: grocery lists,
-- items, item sources and purchase events are isolated per household for every role; every
-- member can shop and edit the list; rows stay inside their household; a check-off records
-- who and when and a stale uncheck can't clear it; deleting an item tombstones its sources;
-- the pantry syncs; account and household deletion cover every grocery table.
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

-- Every read and write a member of household A might try against household B.
create function tests.cannot_reach_household_b(label text)
returns setof text language plpgsql as $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  b_list constant uuid := 'bbbbbbbb-1111-0000-0000-000000000001';
  b_item constant uuid := 'bbbbbbbb-2222-0000-0000-000000000001';
begin
  return next is_empty(
    format('select id from public.grocery_lists where household_id = %L', b),
    label || ': cannot read household B''s lists');
  return next is_empty(
    format('select id from public.grocery_items where household_id = %L', b),
    label || ': cannot read household B''s items');
  return next is_empty(
    format('select id from public.grocery_item_sources where household_id = %L', b),
    label || ': cannot read household B''s item sources');
  return next is_empty(
    format('select id from public.purchase_events where household_id = %L', b),
    label || ': cannot read household B''s purchases');
  return next is_empty(
    format('update public.grocery_items set checked = true where household_id = %L returning id', b),
    label || ': cannot check off household B''s items');
  return next throws_ok(
    format($q$insert into public.grocery_items (id, household_id, list_id, custom_name, origin)
      values (gen_random_uuid(), %L, %L, 'Intruder', 'manual')$q$, b, b_list), '42501', null,
    label || ': cannot add an item to household B''s list');
  return next throws_ok(
    format($q$insert into public.purchase_events (id, household_id, list_id, item_id, occurred_at, source)
      values (gen_random_uuid(), %L, %L, %L, now(), 'checked_off')$q$, b, b_list, b_item), '42501', null,
    label || ': cannot record a purchase in household B');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (Premium: parent, family member, caregiver), household B (Free:
-- parent), and C, a user in no household.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'c-nobody@example.test', 'authenticated', 'authenticated');

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

-- In each household: a household ingredient, a recipe using it, a dinner of that recipe, the
-- week's list, a plan item for the ingredient with its source, and a purchase of it.
create function tests.add_list(h text, parent uuid) returns void language plpgsql as $$
declare
  hid constant uuid := ('00000000-0000-0000-0000-0000000000' || h)::uuid;
  prefix constant text := case h when '0a' then 'aaaaaaaa' else 'bbbbbbbb' end;
  ingredient constant text := 'ingredient.h.' || replace(hid::text, '-', '');
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', parent, 'role', 'authenticated')::text, true);
  insert into public.ingredients (id, household_id, default_dimension) values (ingredient, hid, 'count');
  insert into public.recipes (id, household_id, title, content_locale)
  values ((prefix || '-3333-0000-0000-000000000001')::uuid, hid, 'Flatbread', 'en-US');
  insert into public.recipe_ingredients (id, household_id, recipe_id, position, ingredient_id, quantity)
  values ((prefix || '-4444-0000-0000-000000000001')::uuid, hid,
          (prefix || '-3333-0000-0000-000000000001')::uuid, 0, ingredient, 2);
  insert into public.plan_entries (id, household_id, date, slot, recipe_id, servings)
  values ((prefix || '-5555-0000-0000-000000000001')::uuid, hid, '2026-11-16', 'dinner',
          (prefix || '-3333-0000-0000-000000000001')::uuid, 4);
  insert into public.grocery_lists (id, household_id, week_start)
  values ((prefix || '-1111-0000-0000-000000000001')::uuid, hid, '2026-11-15');
  insert into public.grocery_items (id, household_id, list_id, ingredient_id, dimension,
    quantity_base, origin, plan_quantity_base)
  values ((prefix || '-2222-0000-0000-000000000001')::uuid, hid,
          (prefix || '-1111-0000-0000-000000000001')::uuid, ingredient, 'count', 2, 'plan', 2);
  insert into public.grocery_item_sources (id, household_id, item_id, plan_entry_id,
    recipe_ingredient_id, quantity_base)
  values ((prefix || '-6666-0000-0000-000000000001')::uuid, hid,
          (prefix || '-2222-0000-0000-000000000001')::uuid,
          (prefix || '-5555-0000-0000-000000000001')::uuid,
          (prefix || '-4444-0000-0000-000000000001')::uuid, 2);
  insert into public.purchase_events (id, household_id, list_id, item_id, ingredient_id,
    dimension, quantity_base, occurred_at, source)
  values ((prefix || '-7777-0000-0000-000000000001')::uuid, hid,
          (prefix || '-1111-0000-0000-000000000001')::uuid,
          (prefix || '-2222-0000-0000-000000000001')::uuid, ingredient, 'count', 2, now(), 'checked_off');
end;
$$;
select tests.add_list('0a', 'aaaaaaaa-0000-0000-0000-000000000001');
select tests.add_list('0b', 'bbbbbbbb-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Isolation: every role in A, and a user in no household
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select tests.cannot_reach_household_b('parent');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select tests.cannot_reach_household_b('family member');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select tests.cannot_reach_household_b('caregiver');

select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select is_empty('select id from public.grocery_items', 'a user in no household reads no list items');
select is_empty('select id from public.grocery_lists', 'a user in no household reads no lists');

set role anon;
select throws_ok('select id from public.grocery_items', '42501', null, 'anon cannot read list items');

-- ---------------------------------------------------------------------------
-- Every member shops and edits the list (spec section 2.2, rows 26 to 28)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select count(*) from public.grocery_items where household_id = '00000000-0000-0000-0000-00000000000a'),
  1::bigint, 'a caregiver reads the household''s list');
select lives_ok($$
  insert into public.grocery_items (id, household_id, list_id, custom_name, origin, section_id)
  values ('aaaaaaaa-2222-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
          'aaaaaaaa-1111-0000-0000-000000000001', 'Birthday card', 'manual', 'section.other')
$$, 'a caregiver adds a free-text item');
select lives_ok($$
  update public.grocery_items set checked = true, version = 1
  where id = 'aaaaaaaa-2222-0000-0000-000000000002'
$$, 'a caregiver checks an item off');
select results_eq(
  $$select checked_by, checked_at is not null from public.grocery_items
    where id = 'aaaaaaaa-2222-0000-0000-000000000002'$$,
  $$values ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, true)$$,
  'the check-off records who and when (FR-LIST-8)');

-- A stale uncheck, based on the version before the check-off, can't clear it.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
update public.grocery_items set checked = false, version = 1
where id = 'aaaaaaaa-2222-0000-0000-000000000002';
select is(
  (select checked from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000002'),
  true, 'a stale uncheck does not clear a newer check-off');

select lives_ok($$
  insert into public.purchase_events (id, household_id, list_id, item_id, occurred_at, source,
    recorded_by)
  values ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
          'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000002', now(),
          'checked_off', 'aaaaaaaa-0000-0000-0000-000000000001')
$$, 'a family member records a purchase');
select is(
  (select recorded_by from public.purchase_events where id = 'aaaaaaaa-7777-0000-0000-000000000002'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'a purchase is recorded as the member who wrote it, whatever the client says');
select throws_ok($$
  insert into public.purchase_events (id, household_id, list_id, item_id, occurred_at, source)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
          'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000002', now(),
          'confirmed')
$$, '23505', null, 'an item has at most one purchase event (R-MEM-1)');

select throws_ok($$
  delete from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000002'
$$, '42501', null, 'items cannot be hard-deleted');

-- ---------------------------------------------------------------------------
-- Rows stay inside their household
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok($$
  insert into public.grocery_items (id, household_id, list_id, custom_name, origin)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
          'bbbbbbbb-1111-0000-0000-000000000001', 'Sneaky', 'manual')
$$, '23514', null, 'an item cannot go on another household''s list');
select throws_ok($$
  insert into public.grocery_items (id, household_id, list_id, ingredient_id, origin)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
          'aaaaaaaa-1111-0000-0000-000000000001', 'ingredient.h.0000000000000000000000000000000b', 'manual')
$$, '23514', null, 'an item cannot use another household''s ingredient');
select throws_ok($$
  insert into public.grocery_item_sources (id, household_id, item_id, plan_entry_id, recipe_ingredient_id)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
          'aaaaaaaa-2222-0000-0000-000000000001', 'bbbbbbbb-5555-0000-0000-000000000001',
          'bbbbbbbb-4444-0000-0000-000000000001')
$$, '23514', null, 'a source cannot point at another household''s plan');
select throws_ok($$
  update public.grocery_items set list_id = 'aaaaaaaa-1111-0000-0000-000000000009'
  where id = 'aaaaaaaa-2222-0000-0000-000000000001'
$$, '23514', null, 'an item cannot move to another list');
select throws_ok($$
  insert into public.grocery_items (id, household_id, list_id, origin)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
          'aaaaaaaa-1111-0000-0000-000000000001', 'manual')
$$, '23514', null, 'an item needs an ingredient or a name');
select throws_ok($$
  insert into public.grocery_items (id, household_id, list_id, custom_name, origin)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
          'aaaaaaaa-1111-0000-0000-000000000001', 'From the plan', 'plan')
$$, '23514', null, 'a plan item always has an ingredient');
select throws_ok($$
  insert into public.grocery_lists (id, household_id, week_start)
  values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-11-15')
$$, '23505', null, 'a household has one default list per week (FR-LIST-1)');

-- ---------------------------------------------------------------------------
-- Deleting an item deletes its sources as tombstones; a source added to a deleted item
-- arrives deleted
-- ---------------------------------------------------------------------------
update public.grocery_items set deleted_at = now() where id = 'aaaaaaaa-2222-0000-0000-000000000001';
select isnt(
  (select deleted_at from public.grocery_item_sources where id = 'aaaaaaaa-6666-0000-0000-000000000001'),
  null, 'deleting an item deletes its sources');
insert into public.grocery_item_sources (id, household_id, item_id, plan_entry_id, recipe_ingredient_id)
values ('aaaaaaaa-6666-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
        'aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000001',
        'aaaaaaaa-4444-0000-0000-000000000001');
select isnt(
  (select deleted_at from public.grocery_item_sources where id = 'aaaaaaaa-6666-0000-0000-000000000002'),
  null, 'a source written offline for a deleted item arrives deleted');
select results_eq(
  $$select version > 0 from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'$$,
  $$values (true)$$, 'the server versions list items (sync rules)');

-- ---------------------------------------------------------------------------
-- The pantry syncs: the server versions its rows, and they can't be hard-deleted
-- ---------------------------------------------------------------------------
insert into public.pantry_items (household_id, ingredient_id, status, have_week_start)
values ('00000000-0000-0000-0000-00000000000a', 'ingredient.milk', 'have', '2026-11-15');
select is(
  (select version from public.pantry_items where household_id = '00000000-0000-0000-0000-00000000000a'
     and ingredient_id = 'ingredient.milk' and status = 'have'),
  1, 'a new pantry row gets a server version');
update public.pantry_items set deleted_at = now()
where household_id = '00000000-0000-0000-0000-00000000000a' and ingredient_id = 'ingredient.milk'
  and status = 'have';
select is(
  (select version from public.pantry_items where household_id = '00000000-0000-0000-0000-00000000000a'
     and ingredient_id = 'ingredient.milk' and status = 'have'),
  2, 'undoing "have" is a versioned tombstone');

-- ---------------------------------------------------------------------------
-- Deletion (A-04.3): the registry covers every grocery table and user column
-- ---------------------------------------------------------------------------
reset role;
select set_eq(
  $$select table_name::text || '.' || column_name || ':' || scope from private.deletion_registry
    where table_name::text in ('grocery_lists', 'grocery_items', 'grocery_item_sources', 'purchase_events')$$,
  array['grocery_lists.household_id:household', 'grocery_items.household_id:household',
        'grocery_item_sources.household_id:household', 'purchase_events.household_id:household',
        'grocery_items.checked_by:user', 'purchase_events.recorded_by:user'],
  'every grocery table and user column is registered for deletion');

-- Deleting the caregiver's and the family member's accounts clears them from A's list.
select private.erase_user('aaaaaaaa-0000-0000-0000-000000000003');
select private.erase_user('aaaaaaaa-0000-0000-0000-000000000002');
select is(
  (select checked_by from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000002'),
  null, 'account deletion clears who checked an item');
select is(
  (select checked from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000002'),
  true, 'and the item stays checked for the household');
select is(
  (select recorded_by from public.purchase_events where id = 'aaaaaaaa-7777-0000-0000-000000000002'),
  null, 'account deletion clears who recorded a purchase');

-- Deleting household A removes every grocery row of A, and none of B's.
select private.erase_household('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*) from public.grocery_lists where household_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*) from public.grocery_items where household_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*) from public.grocery_item_sources where household_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*) from public.purchase_events where household_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*) from public.pantry_items where household_id = '00000000-0000-0000-0000-00000000000a'),
  0::bigint, 'household deletion removes every grocery and pantry row');
select is(
  (select count(*) from public.grocery_lists where household_id = '00000000-0000-0000-0000-00000000000b')
  + (select count(*) from public.grocery_items where household_id = '00000000-0000-0000-0000-00000000000b')
  + (select count(*) from public.grocery_item_sources where household_id = '00000000-0000-0000-0000-00000000000b')
  + (select count(*) from public.purchase_events where household_id = '00000000-0000-0000-0000-00000000000b'),
  4::bigint, 'and leaves household B''s list alone');

select * from finish();
rollback;
