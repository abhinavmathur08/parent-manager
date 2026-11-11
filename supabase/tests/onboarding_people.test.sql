-- H-02.2, FR-ONB-2, FR-ONB-4, FR-ONB-6, FR-HH-12, NFR-SEC-4, D-6: complete_onboarding creates
-- the household with its people and codes in one transaction; only the due month is stored
-- for expecting; codes are fixed; removing a person removes their codes; households stay
-- isolated.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

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

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-partner@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'c-parent@example.test', 'authenticated', 'authenticated');

-- Household B already exists, with one child.
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');
insert into public.household_people (id, household_id, display_name, kind, age_band) values
  ('bbbbbbbb-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Pip', 'child', 'toddler');

-- ---------------------------------------------------------------------------
-- Structure: the due month only, and fixed codes (FR-ONB-4, NFR-SEC-4, FR-HH-12)
-- ---------------------------------------------------------------------------
select col_type_is('public', 'household_people', 'due_month', 'text',
  'due_month is text, so a day cannot be stored');
select throws_ok(
  $$insert into public.household_people (household_id, display_name, kind, age_band, due_month)
    values ('00000000-0000-0000-0000-00000000000b', 'x', 'child', 'expecting', '2027-03-15')$$,
  '23514', null, 'a full due date is refused');
select throws_ok(
  $$insert into public.household_people (household_id, display_name, kind, age_band, due_month)
    values ('00000000-0000-0000-0000-00000000000b', 'x', 'child', 'toddler', '2027-03')$$,
  '23514', null, 'only an expecting person has a due month');
select lives_ok(
  $$insert into public.household_people (household_id, display_name, kind, age_band, due_month)
    values ('00000000-0000-0000-0000-00000000000b', 'x', 'child', 'expecting', '2027-03')$$,
  'an expecting person can have a due month');
select throws_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    values ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-1111-0000-0000-000000000001',
      'allergy', 'allergen.kiwi')$$,
  '23514', null, 'an allergen outside the fixed list is refused');
select throws_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    values ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-1111-0000-0000-000000000001',
      'diet', 'diet.keto')$$,
  '23514', null, 'a diet outside the fixed list is refused');

-- ---------------------------------------------------------------------------
-- complete_onboarding
-- ---------------------------------------------------------------------------
select tests.as_anon();
select throws_ok(
  $$select public.complete_onboarding('x', 'US', 'en-US', 'us_customary', 'UTC', 7::smallint, '[]')$$,
  '42501', null, 'anon: cannot complete onboarding');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
-- One bad code rolls everything back: no household without its answers.
select throws_ok(
  $$select public.complete_onboarding('Home', 'US', 'en-US', 'us_customary', 'America/New_York',
    7::smallint, '[{"display_name": "Sam", "age_band": "adult", "is_self": true,
      "allergies": ["allergen.kiwi"], "diets": []}]')$$,
  '23514', null, 'an invalid code refuses the whole onboarding');
select is_empty(
  $$select 1 from public.household_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'and creates no household');
select throws_ok(
  $$select public.complete_onboarding('Home', 'US', 'en-US', 'us_customary', 'America/New_York',
    7::smallint, (select jsonb_agg(jsonb_build_object('display_name', 'x', 'age_band', 'adult'))
      from generate_series(1, 21)))$$,
  '22023', null, 'more than 20 people are refused');
select throws_ok(
  $$select public.complete_onboarding('Home', 'US', 'en-US', 'us_customary', 'America/New_York',
    7::smallint, '[{"display_name": "a", "age_band": "adult", "is_self": true},
      {"display_name": "b", "age_band": "adult", "is_self": true}]')$$,
  '22023', null, 'only one person can be the caller');

select lives_ok(
  $$select public.complete_onboarding('Home', 'US', 'en-US', 'us_customary', 'America/New_York',
    7::smallint, '[
      {"display_name": " Sam ", "age_band": "adult", "due_month": null, "is_self": true,
       "allergies": [], "diets": ["diet.vegetarian"]},
      {"display_name": "Baby", "age_band": "expecting", "due_month": "2027-04", "is_self": false,
       "allergies": ["allergen.milk"], "diets": ["diet.vegan"]},
      {"display_name": "Mo", "age_band": "toddler", "due_month": "2027-04", "is_self": false,
       "allergies": ["allergen.peanut", "allergen.peanut", "allergen.egg"], "diets": []}
    ]')$$,
  'a new user completes onboarding');

create temporary table onboarded on commit drop as
  select household_id as id from public.household_members
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
grant select on onboarded to authenticated;

select results_eq(
  $$select display_name, kind, age_band, due_month, linked_user_id
    from public.household_people where household_id = (select id from onboarded)
    order by display_name$$,
  $$values ('Baby', 'child', 'expecting', '2027-04', null::uuid),
           ('Mo', 'child', 'toddler', null, null),
           ('Sam', 'adult', 'adult', null, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'people are saved by age band, the due month only for expecting, and the caller linked');
select results_eq(
  $$select p.display_name, d.type, d.code from public.person_dietary d
    join public.household_people p on p.id = d.person_id
    where d.household_id = (select id from onboarded) order by 1, 2, 3$$,
  $$values ('Mo', 'allergy', 'allergen.egg'), ('Mo', 'allergy', 'allergen.peanut'),
           ('Sam', 'diet', 'diet.vegetarian')$$,
  'codes are saved once each, and none for someone not yet born');
select isnt_empty(
  $$select 1 from public.pantry_items where household_id = (select id from onboarded)
    and status = 'staple'$$,
  'the region''s default staples are added without a setup screen (FR-ONB-6)');
select throws_ok(
  $$select public.complete_onboarding('Again', 'US', 'en-US', 'us_customary', 'UTC', 7::smallint, '[]')$$,
  'P0001', null, 'a second onboarding is refused');

-- Household B can't see household A's people or codes.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty(
  $$select 1 from public.household_people where household_id <> '00000000-0000-0000-0000-00000000000b'$$,
  'another household cannot read the onboarded people');
select is_empty(
  $$select 1 from public.person_dietary where household_id <> '00000000-0000-0000-0000-00000000000b'$$,
  'another household cannot read the onboarded codes');

-- ---------------------------------------------------------------------------
-- Two parents editing codes at once keep both (H-05)
-- ---------------------------------------------------------------------------
reset role;
insert into public.household_members (household_id, user_id, role)
select id, 'aaaaaaaa-0000-0000-0000-000000000002', 'parent' from onboarded;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    select household_id, id, 'allergy', 'allergen.sesame' from public.household_people
    where display_name = 'Mo'$$,
  'parent 1 adds an allergy');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    select household_id, id, 'allergy', 'allergen.soy' from public.household_people
    where display_name = 'Mo'$$,
  'parent 2 adds another allergy at the same time');
select throws_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    select household_id, id, 'allergy', 'allergen.sesame' from public.household_people
    where display_name = 'Mo'$$,
  '23505', null, 'adding a code that is already there is refused, not duplicated');
select results_eq(
  $$select code from public.person_dietary d join public.household_people p on p.id = d.person_id
    where p.display_name = 'Mo' and d.deleted_at is null order by code$$,
  array['allergen.egg', 'allergen.peanut', 'allergen.sesame', 'allergen.soy'],
  'both parents'' codes are kept');

-- ---------------------------------------------------------------------------
-- Removing a person removes their codes (H-05)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.household_people set deleted_at = now() where display_name = 'Mo'$$,
  'a parent removes a person');
select is_empty(
  $$select 1 from public.person_dietary d join public.household_people p on p.id = d.person_id
    where p.display_name = 'Mo' and d.deleted_at is null$$,
  'their codes are removed with them');
select throws_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    select household_id, id, 'allergy', 'allergen.fish' from public.household_people
    where display_name = 'Mo'$$,
  '23514', null, 'a removed person cannot be given new codes');
select results_eq(
  $$select count(*)::int from public.person_dietary d join public.household_people p
    on p.id = d.person_id where p.display_name = 'Sam' and d.deleted_at is null$$,
  array[1], 'other people''s codes are untouched');
reset role;

select * from finish();
rollback;
