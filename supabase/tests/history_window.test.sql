-- G-08 (FR-LIST-13, FR-PAY-6, FR-PAY-9): a free household reads the plans and lists of the
-- current week and the 4 before it; older weeks are hidden on the server but kept, and come
-- back with Premium.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Week starts relative to the free window, so the test holds on any date.
create table tests.weeks as
select private.free_history_start('00000000-0000-0000-0000-00000000000a') as oldest_free;

create function tests.week(offset_weeks integer) returns date language sql as $$
  select oldest_free + offset_weeks * 7 from tests.weeks
$$;

grant select on tests.weeks to authenticated;
grant execute on all functions in schema tests to anon, authenticated;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver');

insert into public.household_people (id, household_id, display_name, kind, age_band) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Bean', 'child', 'toddler');

-- The table was created before the household existed; recompute now.
update tests.weeks set oldest_free = private.free_history_start('00000000-0000-0000-0000-00000000000a');

-- An entry in the oldest free week, one the week before it, and one this week.
insert into public.plan_entries (id, household_id, date, slot, free_text, servings) values
  ('aaaaaaaa-3333-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', tests.week(0), 'dinner', 'Kept in view', 2),
  ('aaaaaaaa-3333-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', tests.week(0) - 1, 'dinner', 'Older', 2),
  ('aaaaaaaa-3333-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', tests.week(4) + 2, 'dinner', 'This week', 2);
insert into public.plan_entry_portions (id, household_id, entry_id, person_id, portions) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 1),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000001', 1);

insert into public.grocery_lists (id, household_id, week_start) values
  ('aaaaaaaa-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', tests.week(0)),
  ('aaaaaaaa-4444-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', tests.week(-1));
insert into public.grocery_items (id, household_id, list_id, ingredient_id, dimension, quantity_base, origin) values
  ('aaaaaaaa-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-4444-0000-0000-000000000001', 'ingredient.milk', 'volume', 500, 'manual'),
  ('aaaaaaaa-5555-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-4444-0000-0000-000000000002', 'ingredient.milk', 'volume', 500, 'manual');

-- ---------------------------------------------------------------------------
-- Free
-- ---------------------------------------------------------------------------
select is(extract(dow from tests.week(0))::int, 0, 'the window starts on the week start');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select isnt(public.history_window(), null, 'a free household has a history window');
select is(public.history_window(), tests.week(0), 'starting 4 weeks before the current week');
select results_eq('select free_text from public.plan_entries order by date',
  array['Kept in view', 'This week'],
  'Free reads plans from the current week and the 4 before it only (FR-PAY-6)');
select is((select count(*)::int from public.plan_entry_portions), 1,
  'and only those entries'' portions');
select results_eq('select week_start from public.grocery_lists', array[tests.week(0)],
  'Free reads lists inside the window only (FR-LIST-13)');
select results_eq('select id from public.grocery_items',
  array['aaaaaaaa-5555-0000-0000-000000000001'::uuid], 'and only their items');
select is_empty(
  $$update public.plan_entries set free_text = 'x'
    where id = 'aaaaaaaa-3333-0000-0000-000000000002' returning id$$,
  'an older week cannot be edited on Free');
select throws_ok(
  format($$insert into public.plan_entries (id, household_id, date, slot, free_text, servings)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', %L, 'dinner', 'x', 2)
    returning id$$, tests.week(-2)),
  '42501', null, 'or added to');
select lives_ok(
  format($$insert into public.plan_entries (id, household_id, date, slot, free_text, servings)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', %L, 'lunch', 'Next week', 2)
    returning id$$, tests.week(5) + 1),
  'next week can be planned on Free');
reset role;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty('select id from public.plan_entries', 'a paused caregiver reads nothing');
reset role;

select is((select count(*)::int from public.plan_entries
           where household_id = '00000000-0000-0000-0000-00000000000a'), 4,
  'older weeks are kept, not deleted');
select is((select count(*)::int from public.grocery_items
           where household_id = '00000000-0000-0000-0000-00000000000a'), 2,
  'with their lists and items');

-- ---------------------------------------------------------------------------
-- Premium: everything
-- ---------------------------------------------------------------------------
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(public.history_window(), null, 'Premium has no history window');
select is((select count(*)::int from public.plan_entries), 4, 'Premium reads every week''s plan');
select is((select count(*)::int from public.plan_entry_portions), 2, 'with every portion');
select is((select count(*)::int from public.grocery_lists), 2, 'and every list');
select is((select count(*)::int from public.grocery_items), 2, 'and every item');
reset role;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is((select count(*)::int from public.plan_entries), 4,
  'the caregiver is back and reads the history too');
reset role;

-- ---------------------------------------------------------------------------
-- Lapse (FR-PAY-9): hidden again, still kept
-- ---------------------------------------------------------------------------
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.plan_entries), 3,
  'after a lapse older weeks are hidden again');
reset role;
select is((select count(*)::int from public.plan_entries
           where household_id = '00000000-0000-0000-0000-00000000000a'), 4, 'and still kept');

select is_empty(
  $$select policyname from pg_catalog.pg_policies
    where tablename = 'purchase_events'
      and coalesce(qual, '') || coalesce(with_check, '') ~ '(history_visible|premium)'$$,
  'purchase memory stays free (FR-PAY-2)');

select * from finish();
rollback;
