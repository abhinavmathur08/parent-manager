-- G-04.2, FR-LIST-10, FR-MEM-1, R-MEM-1: at most one live purchase event per item, a second
-- one (two partners checking off offline) arrives as a tombstone rather than failing, the
-- server records the member; "finish shopping" time is set by the server and never changes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

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
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-one@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-two@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'UTC', 7);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent');
insert into public.grocery_lists (id, household_id, week_start) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-11-15');
insert into public.grocery_items (id, household_id, list_id, ingredient_id, dimension,
  quantity_base, origin, checked) values
  ('aaaaaaaa-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-1111-0000-0000-000000000001', 'ingredient.egg', 'count', 12, 'manual', true);

-- Partner one checks the eggs off and records the purchase.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.purchase_events (id, household_id, list_id, item_id, ingredient_id,
  dimension, quantity_base, occurred_at, source, recorded_by)
values ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
        'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001',
        'ingredient.egg', 'count', 12, now(), 'checked_off', 'aaaaaaaa-0000-0000-0000-000000000002');
select is(
  (select recorded_by from public.purchase_events where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'the event records the member who wrote it, whatever the client sends (FR-MEM-1)');

-- Partner two, offline, recorded the same purchase under another ID.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.purchase_events (id, household_id, list_id, item_id, ingredient_id,
      dimension, quantity_base, occurred_at, source)
    values ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001',
            'ingredient.egg', 'count', 12, now(), 'checked_off')$$,
  'a second event for the item is taken, not refused');
select isnt(
  (select deleted_at from public.purchase_events where id = 'aaaaaaaa-7777-0000-0000-000000000002'),
  null,
  'and arrives as a tombstone');
select is(
  (select count(*)::int from public.purchase_events
   where item_id = 'aaaaaaaa-2222-0000-0000-000000000001' and deleted_at is null),
  1,
  'the item keeps one live event (R-MEM-1)');

-- Unchecking within the undo window deletes the event; a new check-off can record again.
update public.purchase_events set deleted_at = now(), version = 1
where id = 'aaaaaaaa-7777-0000-0000-000000000001';
select lives_ok(
  $$insert into public.purchase_events (id, household_id, list_id, item_id, ingredient_id,
      dimension, quantity_base, occurred_at, source)
    values ('aaaaaaaa-7777-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001',
            'ingredient.egg', 'count', 12, now(), 'confirmed')$$,
  'after an undone purchase the item can record a new one');
select is(
  (select deleted_at from public.purchase_events where id = 'aaaaaaaa-7777-0000-0000-000000000003'),
  null,
  'and it is live');

-- Finish shopping: the server sets the time, and it never changes or clears.
update public.grocery_items set shopped_at = '2000-01-01T00:00:00Z', version = 1
where id = 'aaaaaaaa-2222-0000-0000-000000000001';
select ok(
  (select shopped_at > now() - interval '1 minute' from public.grocery_items
   where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  'finish shopping uses the server''s time, not the client''s');
create temporary table shopped as
  select shopped_at from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001';
update public.grocery_items set shopped_at = null, version = 2
where id = 'aaaaaaaa-2222-0000-0000-000000000001';
select is(
  (select shopped_at from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  (select shopped_at from shopped),
  'a shopped item stays in history');
select is(
  (select checked from public.grocery_items where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  true,
  'and stays checked, so the list engine still counts it');

select * from finish();
rollback;
