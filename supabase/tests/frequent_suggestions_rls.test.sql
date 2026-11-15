-- G-09, FR-MEM-5, NFR-SEC-2: hidden frequently bought suggestions are isolated per household
-- for every role; every member can hide one; the server sets the 90 days; a hide can't use
-- another household's ingredient; household deletion removes them.
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

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
    format('select id from public.frequent_suggestion_hides where household_id = %L', b),
    label || ': cannot read household B''s hidden suggestions');
  return next is_empty(
    format('update public.frequent_suggestion_hides set deleted_at = now() where household_id = %L returning id', b),
    label || ': cannot change household B''s hidden suggestions');
  return next throws_ok(
    format($q$insert into public.frequent_suggestion_hides (id, household_id, ingredient_id, hidden_until)
      values (gen_random_uuid(), %L, 'ingredient.milk', now())$q$, b), '42501', null,
    label || ': cannot hide a suggestion in household B');
end;
$$;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'c-nobody@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'UTC', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
insert into public.ingredients (id, household_id, default_dimension) values
  ('ingredient.h.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '00000000-0000-0000-0000-00000000000b', 'count');
insert into public.frequent_suggestion_hides (id, household_id, ingredient_id, hidden_until) values
  ('bbbbbbbb-8888-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'ingredient.banana', now());

-- Isolation: every role in A, and a user in no household.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select tests.cannot_reach_household_b('parent');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select tests.cannot_reach_household_b('family member');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select tests.cannot_reach_household_b('caregiver');
select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select tests.cannot_reach_household_b('user in no household');

-- Every member can hide a suggestion (spec section 2.2, row 28), for 90 days by the server.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select lives_ok(
  $$insert into public.frequent_suggestion_hides (id, household_id, ingredient_id, hidden_until)
    values ('aaaaaaaa-8888-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
            'ingredient.banana', now() + interval '10 years')$$,
  'a caregiver can hide a suggestion');
select ok(
  (select hidden_until between now() + interval '89 days' and now() + interval '91 days'
   from public.frequent_suggestion_hides where id = 'aaaaaaaa-8888-0000-0000-000000000001'),
  'the server hides it for 90 days, whatever the client asks (FR-MEM-5)');
select throws_ok(
  $$insert into public.frequent_suggestion_hides (id, household_id, ingredient_id, hidden_until)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'ingredient.banana', now())$$,
  '23505', null, 'one live hide per ingredient');
select throws_ok(
  $$insert into public.frequent_suggestion_hides (id, household_id, ingredient_id, hidden_until)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'ingredient.h.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', now())$$,
  '23514', null, 'a hide cannot use another household''s ingredient');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$update public.frequent_suggestion_hides set hidden_until = now(), version = 1
    where id = 'aaaaaaaa-8888-0000-0000-000000000001'$$,
  'hiding it again updates the same row');
select ok(
  (select hidden_until > now() + interval '89 days'
   from public.frequent_suggestion_hides where id = 'aaaaaaaa-8888-0000-0000-000000000001'),
  'and restarts the 90 days');

-- Household deletion (A-04.3).
reset role;
select set_config('request.jwt.claims', '', true);
select private.erase_household('00000000-0000-0000-0000-00000000000a');
select is_empty(
  $$select id from public.frequent_suggestion_hides
    where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'household deletion removes its hidden suggestions');

select * from finish();
rollback;
