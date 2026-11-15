-- P-05 (FR-PLAN-10, FR-PAY-3, FR-PAY-9): saved week templates are Premium only, for parents
-- and family members, isolated per household, hidden but kept after a lapse, and capped.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

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

-- B is Premium, with a template of its own.
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000b';
insert into public.week_templates (id, household_id, name, entries) values
  ('bbbbbbbb-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'B week', '[]');

-- ---------------------------------------------------------------------------
-- Free: no templates (FR-PLAN-10, server enforced)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into public.week_templates (household_id, name, entries)
    values ('00000000-0000-0000-0000-00000000000a', 'Usual week', '[]')$$,
  '42501', null, 'a free household cannot save a template');
reset role;

-- ---------------------------------------------------------------------------
-- Premium
-- ---------------------------------------------------------------------------
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.week_templates (id, household_id, name, entries, created_by)
    values ('aaaaaaaa-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
      'Usual week', '[{"day":0,"slot":"dinner","position":0,"free_text":"Tacos","servings":4}]',
      'bbbbbbbb-0000-0000-0000-000000000001')$$,
  'a Premium parent saves a template');
select is((select created_by from public.week_templates
           where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the saver is stamped, whatever was sent');
select results_eq('select name from public.week_templates', array['Usual week'],
  'a parent sees only their household''s templates');
select is_empty(
  $$update public.week_templates set name = 'x'
    where household_id = '00000000-0000-0000-0000-00000000000b' returning id$$,
  'and cannot rename household B''s');
select throws_ok(
  $$insert into public.week_templates (household_id, name, entries)
    values ('00000000-0000-0000-0000-00000000000b', 'x', '[]')$$,
  '42501', null, 'or save into household B');
select throws_ok(
  $$insert into public.week_templates (household_id, name, entries)
    values ('00000000-0000-0000-0000-00000000000a', repeat('x', 61), '[]')$$,
  '23514', null, 'a name is at most 60 characters');
reset role;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.week_templates (household_id, name, entries)
    values ('00000000-0000-0000-0000-00000000000a', 'Family week', '[]')$$,
  'a family member saves a template');
select is((select count(*)::int from public.week_templates), 2, 'and sees both');
reset role;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty('select id from public.week_templates', 'a caregiver sees no templates');
select throws_ok(
  $$insert into public.week_templates (household_id, name, entries)
    values ('00000000-0000-0000-0000-00000000000a', 'x', '[]')$$,
  '42501', null, 'and cannot save one');
reset role;

-- The cap (PROPOSED: 50).
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.week_templates (household_id, name, entries)
    select '00000000-0000-0000-0000-00000000000a', 'T' || n, '[]' from generate_series(3, 50) n$$,
  'a household can keep 50 templates');
select throws_ok(
  $$insert into public.week_templates (household_id, name, entries)
    values ('00000000-0000-0000-0000-00000000000a', 'One too many', '[]')$$,
  'P0001', null, 'but not 51');
reset role;

-- ---------------------------------------------------------------------------
-- Lapse (FR-PAY-9): hidden, not deleted; back with Premium
-- ---------------------------------------------------------------------------
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is_empty('select id from public.week_templates', 'after a lapse templates are hidden');
reset role;
select is((select count(*)::int from public.week_templates
           where household_id = '00000000-0000-0000-0000-00000000000a'), 50,
  'but every one is kept');
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.week_templates), 50, 'and they return with Premium');
select is_empty(
  $$delete from public.week_templates
    where household_id = '00000000-0000-0000-0000-00000000000b' returning id$$,
  'nobody can delete another household''s templates');
reset role;

select * from finish();
rollback;
