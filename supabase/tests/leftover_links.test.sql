-- P-04, FR-PLAN-8, R-SERV-3, NFR-SEC-2: a leftover link points at a live, earlier entry of the
-- same household at most 13 days before; a link that doesn't hold is dropped, not refused, so
-- offline writes still sync; moving an entry drops links that no longer hold; chains are
-- allowed; caregivers and other households can't link.
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

create function tests.link_of(entry uuid) returns uuid language sql as $$
  select leftover_of_entry_id from public.plan_entries where id = entry
$$;
grant execute on function tests.link_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (parent, caregiver), household B (parent).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 1),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

insert into public.recipes (id, household_id, title, content_locale) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Chili', 'en-US');

insert into public.plan_entries (id, household_id, date, slot, recipe_id, free_text, servings) values
  -- a1: Monday dinner, chili. a2: Tuesday lunch. a3: Monday breakfast. a4: two weeks before.
  -- a5: Wednesday dinner. a6: removed.
  ('aaaaaaaa-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'dinner',
   'aaaaaaaa-1111-0000-0000-000000000001', null, 4),
  ('aaaaaaaa-4444-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '2026-11-17', 'lunch',
   null, 'Lunch', 2),
  ('aaaaaaaa-4444-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'breakfast',
   null, 'Toast', 2),
  ('aaaaaaaa-4444-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '2026-11-03', 'dinner',
   null, 'Soup', 2),
  ('aaaaaaaa-4444-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', '2026-11-18', 'dinner',
   null, 'Wednesday', 2),
  ('aaaaaaaa-4444-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000a', '2026-11-15', 'dinner',
   null, 'Removed', 2),
  ('bbbbbbbb-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-11-16', 'dinner',
   null, 'Pie', 2);
update public.plan_entries set deleted_at = now() where id = 'aaaaaaaa-4444-0000-0000-000000000006';

-- ---------------------------------------------------------------------------
-- Who can link
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty(
  $$update public.plan_entries set leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000001'
    where id = 'aaaaaaaa-4444-0000-0000-000000000002' returning id$$,
  'a caregiver can''t link leftovers');
reset role;

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty(
  $$update public.plan_entries set leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000001'
    where id = 'aaaaaaaa-4444-0000-0000-000000000002' returning id$$,
  'another household''s parent can''t link household A''s entries');
select throws_ok(
  $$update public.plan_entries set leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000001'
    where id = 'bbbbbbbb-4444-0000-0000-000000000001'$$,
  '23514', null, 'a link can''t reach another household''s entry');
reset role;
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000002'), null, 'the refused links left nothing behind');

-- ---------------------------------------------------------------------------
-- A parent links (FR-PLAN-8)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');

select lives_ok(
  $$update public.plan_entries set leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000001'
    where id = 'aaaaaaaa-4444-0000-0000-000000000002'$$,
  'a parent marks Tuesday lunch as leftovers of Monday dinner');
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000002'), 'aaaaaaaa-4444-0000-0000-000000000001'::uuid,
  'the link to an earlier day holds');

select lives_ok(
  $$update public.plan_entries set leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000002'
    where id = 'aaaaaaaa-4444-0000-0000-000000000005'$$,
  'leftovers of leftovers: a chain');
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000005'), 'aaaaaaaa-4444-0000-0000-000000000002'::uuid,
  'chains are allowed (R-SERV-3)');

select lives_ok(
  $$update public.plan_entries set leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000001'
    where id = 'aaaaaaaa-4444-0000-0000-000000000003'$$,
  'a link to a later slot the same day still syncs');
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000003'), null,
  'but a link can''t point at a later slot');

select lives_ok(
  $$update public.plan_entries set leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000005'
    where id = 'aaaaaaaa-4444-0000-0000-000000000001'$$,
  'a link to a later day still syncs');
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000001'), null,
  'but a link can''t point at a later entry, so there are no loops');

select lives_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, free_text, servings, leftover_of_entry_id)
    values ('aaaaaaaa-4444-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000a',
            '2026-11-17', 'dinner', 'Too old', 2, 'aaaaaaaa-4444-0000-0000-000000000004')$$,
  'an entry linked to one two weeks earlier still syncs');
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000007'), null,
  'but the link reaches back one week at most');

select lives_ok(
  $$update public.plan_entries set leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000006'
    where id = 'aaaaaaaa-4444-0000-0000-000000000003'$$,
  'a link to a removed entry still syncs');
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000003'), null,
  'but it''s dropped');

-- ---------------------------------------------------------------------------
-- Moves
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.plan_entries set date = '2026-11-15' where id = 'aaaaaaaa-4444-0000-0000-000000000002'$$,
  'moving leftovers before their source still syncs');
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000002'), null,
  'the moved entry''s link is dropped');

update public.plan_entries
set date = '2026-11-17', leftover_of_entry_id = 'aaaaaaaa-4444-0000-0000-000000000001'
where id = 'aaaaaaaa-4444-0000-0000-000000000002';
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000002'), 'aaaaaaaa-4444-0000-0000-000000000001'::uuid,
  'moving back and linking again holds');
select lives_ok(
  $$update public.plan_entries set slot = 'breakfast' where id = 'aaaaaaaa-4444-0000-0000-000000000001'$$,
  'moving the source within its day keeps links that still hold');
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000002'), 'aaaaaaaa-4444-0000-0000-000000000001'::uuid,
  'Tuesday lunch is still leftovers of Monday');
update public.plan_entries set date = '2026-11-18' where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select is(tests.link_of('aaaaaaaa-4444-0000-0000-000000000002'), null,
  'moving the source after its leftovers drops their link');
reset role;

select * from finish();
rollback;
