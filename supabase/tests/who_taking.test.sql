-- C-04.2 part 2 (FR2-REM-5): "who's taking?" goes to parents from 18:00 household time for
-- tomorrow's untaken appointments, on Free too, once per parent and occurrence, with IDs and a
-- date only, and is dropped before it's pushed if someone took the appointment since.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- An instant `days` from today at `hhmm`, in New York (household A).
create function tests.ny(days integer, hhmm time) returns timestamptz language sql as $$
  select (((now() at time zone 'America/New_York')::date + days) + hhmm) at time zone 'America/New_York'
$$;
create function tests.ny_date(days integer) returns date language sql as $$
  select (now() at time zone 'America/New_York')::date + days
$$;

create function tests.count(member uuid, kind text) returns integer language sql as $$
  select count(*)::integer from public.notifications where user_id = member and type = kind
$$;

-- Household A (Premium, New York, Sunday weeks): two parents, a family member, a caregiver.
-- Household B (Free, London): two parents.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a3@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'a4@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b1@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b2@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

select ok(
  (select p.who_taking
   from private.notification_prefs_of('aaaaaaaa-0000-0000-0000-000000000001') p),
  '"who''s taking?" is on by default');

-- ---------------------------------------------------------------------------
-- who_taking (FR2-REM-5)
-- ---------------------------------------------------------------------------
delete from public.notifications;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
-- Tomorrow: an untaken appointment, a taken one, an untaken activity, and a weekly
-- appointment whose tomorrow is skipped; a daily appointment whose next-week occurrence was
-- moved to tomorrow.
insert into public.events (id, household_id, kind, title, starts_at, ends_at, taking_user_id, repeat)
values
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'kind.appointment', 'Vaccines', tests.ny(1, '10:00'), tests.ny(1, '11:00'), null, null),
  ('dddddddd-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
   'kind.appointment', 'Dentist', tests.ny(1, '12:00'), tests.ny(1, '13:00'),
   'aaaaaaaa-0000-0000-0000-000000000002', null),
  ('dddddddd-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
   'kind.activity', 'Music', tests.ny(1, '14:00'), tests.ny(1, '15:00'), null, null),
  ('dddddddd-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a',
   'kind.appointment', 'Physio', tests.ny(-6, '09:00'), tests.ny(-6, '10:00'), null,
   jsonb_build_object('freq', 'weekly', 'weekdays',
     jsonb_build_array(extract(isodow from tests.ny_date(1))::integer))),
  ('dddddddd-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a',
   'kind.appointment', 'Speech', tests.ny(3, '09:00'), tests.ny(3, '10:00'), null,
   '{"freq": "weekly", "weekdays": [1, 2, 3, 4, 5, 6, 7], "count": 1}');
insert into public.event_exceptions (id, household_id, event_id, original_date, status) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
   'dddddddd-0000-0000-0000-000000000004', tests.ny_date(1), 'skipped');
insert into public.event_exceptions
  (id, household_id, event_id, original_date, status, starts_at, ends_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
   'dddddddd-0000-0000-0000-000000000005', tests.ny_date(3), 'moved',
   tests.ny(1, '16:00'), tests.ny(1, '17:00'));
reset role;

select set_eq(
  $$select event_id, original_date
    from private.untaken_appointments('00000000-0000-0000-0000-00000000000a', tests.ny_date(1))$$,
  $$values ('dddddddd-0000-0000-0000-000000000001'::uuid, tests.ny_date(1)),
           ('dddddddd-0000-0000-0000-000000000005'::uuid, tests.ny_date(3))$$,
  'tomorrow''s untaken appointments: not taken ones, other kinds or skipped days; moved ones by their new day');

delete from public.notifications;
select is(private.enqueue_who_taking(tests.ny(0, '17:55')), 0, 'nothing before 18:00');
select is(private.enqueue_who_taking(tests.ny(0, '18:05')), 4,
  'at 18:00 each parent gets a prompt for each untaken appointment');
select is(
  tests.count('aaaaaaaa-0000-0000-0000-000000000003', 'who_taking')
    + tests.count('aaaaaaaa-0000-0000-0000-000000000004', 'who_taking'), 0,
  'family members and caregivers get no prompt');
select is(private.enqueue_who_taking(tests.ny(0, '18:10')), 0, 'and only once');
select is(private.enqueue_who_taking(tests.ny(0, '23:30')), 0, 'and never late at night');
select is(
  (select payload from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and type = 'who_taking'
     and payload ->> 'event_id' = 'dddddddd-0000-0000-0000-000000000001'),
  jsonb_build_object('event_id', 'dddddddd-0000-0000-0000-000000000001', 'date', tests.ny_date(1)),
  'the prompt carries the event ID and date only');

-- Free households get it too (FR2-REM-5).
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at) values
  ('dddddddd-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'GP',
   (((now() at time zone 'Europe/London')::date + 1) + time '09:00') at time zone 'Europe/London',
   (((now() at time zone 'Europe/London')::date + 1) + time '10:00') at time zone 'Europe/London');
reset role;
select is(
  private.enqueue_who_taking(
    (((now() at time zone 'Europe/London')::date) + time '18:01') at time zone 'Europe/London'), 2,
  'a Free household''s parents get the prompt too');

-- Sending: dropped once someone takes it.
update public.notifications set deliver_at = now() - interval '1 minute';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
update public.events set taking_user_id = 'aaaaaaaa-0000-0000-0000-000000000002'
where id = 'dddddddd-0000-0000-0000-000000000001';
reset role;
create temp table claimed on commit drop as
  select * from public.claim_pushes() where type = 'who_taking';
select is(
  (select count(*)::integer from claimed
   where payload ->> 'event_id' = 'dddddddd-0000-0000-0000-000000000001'), 0,
  'a prompt for an appointment someone took since is not pushed');
select is(
  (select count(*)::integer from claimed
   where payload ->> 'event_id' = 'dddddddd-0000-0000-0000-000000000005'), 2,
  'the others are');

-- Members read only their own notifications.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select is_empty($$select id from public.notifications where type = 'who_taking'$$,
  'a caregiver cannot read the parents'' prompts');
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty(
  $$select id from public.notifications where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'another household''s members cannot read them');
reset role;

select * from finish();
rollback;
