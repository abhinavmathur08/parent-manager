-- R-02.3, FR-REC-7, FR-REC-11, NFR-SEC-2: deleting a recipe keeps its title on the plan as
-- free text, including for entries that arrive after the delete; only the recipe's own
-- household's entries change; caregivers and other households can't delete it; the fixed tag
-- set includes needs-defrosting.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (parent, caregiver), household B (parent).
-- ---------------------------------------------------------------------------
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

insert into public.recipes (id, household_id, title, tags, content_locale) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Chili',
   '{tag.freezer_friendly,tag.needs_defrosting}', 'en-US'),
  ('aaaaaaaa-1111-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Pancakes', '{}', 'en-US'),
  ('bbbbbbbb-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Shepherd''s pie', '{}', 'en-GB');

insert into public.plan_entries (id, household_id, date, slot, recipe_id, servings) values
  -- Chili, twice, and once removed.
  ('aaaaaaaa-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'dinner',
   'aaaaaaaa-1111-0000-0000-000000000001', 4),
  ('aaaaaaaa-4444-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '2026-11-17', 'lunch',
   'aaaaaaaa-1111-0000-0000-000000000001', 2),
  ('aaaaaaaa-4444-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '2026-11-18', 'dinner',
   'aaaaaaaa-1111-0000-0000-000000000001', 2),
  -- Pancakes stays planned.
  ('aaaaaaaa-4444-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '2026-11-16', 'breakfast',
   'aaaaaaaa-1111-0000-0000-000000000002', 2),
  ('bbbbbbbb-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-11-16', 'dinner',
   'bbbbbbbb-1111-0000-0000-000000000001', 2);
update public.plan_entries set deleted_at = now() where id = 'aaaaaaaa-4444-0000-0000-000000000003';

-- ---------------------------------------------------------------------------
-- Tags (FR-REC-7, spec C-4)
-- ---------------------------------------------------------------------------
select is(
  (select tags from public.recipes where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  array['tag.freezer_friendly', 'tag.needs_defrosting']::text[],
  'a recipe can be tagged needs-defrosting, stored as its ID');
select throws_ok(
  $$update public.recipes set tags = '{Needs defrosting}' where id = 'aaaaaaaa-1111-0000-0000-000000000002'$$,
  '23514', null, 'tags are IDs from the fixed set, never display text');

-- ---------------------------------------------------------------------------
-- Who can delete
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty(
  $$update public.recipes set deleted_at = now() where id = 'aaaaaaaa-1111-0000-0000-000000000001' returning id$$,
  'a caregiver can''t delete a recipe');
reset role;

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty(
  $$update public.recipes set deleted_at = now() where id = 'aaaaaaaa-1111-0000-0000-000000000001' returning id$$,
  'another household''s parent can''t delete the recipe');
select is_empty(
  $$select id from public.plan_entries where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'another household''s parent can''t see the entries a delete would change');
reset role;

select is(
  (select recipe_id from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
  'aaaaaaaa-1111-0000-0000-000000000001'::uuid,
  'the entry still plans the recipe after the refused deletes');

-- ---------------------------------------------------------------------------
-- A parent deletes Chili (FR-REC-11)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$update public.recipes set deleted_at = now() where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  'a parent deletes a planned recipe');
select results_eq(
  $$select recipe_id, free_text from public.plan_entries
    where id in ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-4444-0000-0000-000000000002')
    order by id$$,
  $$values (null::uuid, 'Chili'::text), (null::uuid, 'Chili'::text)$$,
  'each live entry that planned it keeps the title as free text');
select is(
  (select version from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
  2, 'the snapshot is a synced change (its version moves on)');
select is(
  (select recipe_id from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000003'),
  'aaaaaaaa-1111-0000-0000-000000000001'::uuid,
  'a removed entry is a tombstone and doesn''t change');
select is(
  (select recipe_id from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000004'),
  'aaaaaaaa-1111-0000-0000-000000000002'::uuid,
  'entries planning another recipe don''t change');
select is(
  (select free_text from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000004'),
  null, 'entries planning another recipe get no free text');

-- Changes the deleting device never saw.
select lives_ok(
  $$insert into public.plan_entries (id, household_id, date, slot, recipe_id, servings)
    values ('aaaaaaaa-4444-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a',
            '2026-11-19', 'dinner', 'aaaaaaaa-1111-0000-0000-000000000001', 2)$$,
  'an entry added offline for the deleted recipe still syncs');
select results_eq(
  $$select recipe_id, free_text from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000005'$$,
  $$values (null::uuid, 'Chili'::text)$$,
  'it arrives as free text with the recipe''s title');
select lives_ok(
  $$update public.plan_entries set recipe_id = 'aaaaaaaa-1111-0000-0000-000000000001', free_text = null
    where id = 'aaaaaaaa-4444-0000-0000-000000000004'$$,
  'an entry changed offline to plan the deleted recipe still syncs');
select results_eq(
  $$select recipe_id, free_text from public.plan_entries where id = 'aaaaaaaa-4444-0000-0000-000000000004'$$,
  $$values (null::uuid, 'Chili'::text)$$,
  'it keeps the title as free text too');
select lives_ok(
  $$update public.plan_entries set servings = 3 where id = 'aaaaaaaa-4444-0000-0000-000000000001'$$,
  'a snapshotted entry can still be edited');
reset role;

-- ---------------------------------------------------------------------------
-- Isolation (NFR-SEC-2): household B's plan is untouched
-- ---------------------------------------------------------------------------
select results_eq(
  $$select recipe_id, free_text from public.plan_entries where id = 'bbbbbbbb-4444-0000-0000-000000000001'$$,
  $$values ('bbbbbbbb-1111-0000-0000-000000000001'::uuid, null::text)$$,
  'another household''s entries don''t change');

select * from finish();
rollback;
