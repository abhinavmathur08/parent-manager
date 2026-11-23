-- C-04.2 part 1 (FR2-REM-4, FR2-REM-6, D-15, D-16): change notifications go only to the other
-- members who can see the event, on Premium, at most one an hour per event, with IDs and fixed
-- values only, and are checked again before they're pushed. The server's series dates match
-- the device's rule.
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

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
select ok(
  (select p.event_changes and p.calendar_reminders
   from private.notification_prefs_of('aaaaaaaa-0000-0000-0000-000000000001') p),
  'change notifications are on by default');

-- ---------------------------------------------------------------------------
-- Series dates on the server match the device's rule
-- ---------------------------------------------------------------------------
create function tests.dates(event jsonb, week_start smallint, from_date date, to_date date)
returns date[] language sql as $$
  select coalesce(array_agg(d order by d), '{}')
  from private.event_dates(jsonb_populate_record(null::public.events, event),
    'America/New_York', week_start, from_date, to_date) d
$$;

select is(
  tests.dates('{"all_day": false, "starts_at": "2026-11-02T15:00:00Z",
    "repeat": {"freq": "weekly", "interval": 2, "weekdays": [1, 3]}}', 7::smallint,
    '2026-11-01', '2026-11-30'),
  array['2026-11-02', '2026-11-04', '2026-11-16', '2026-11-18', '2026-11-30']::date[],
  'every 2 weeks on Monday and Wednesday, counted from the first week');
select is(
  tests.dates('{"all_day": true, "start_date": "2026-01-31", "end_date": "2026-01-31",
    "repeat": {"freq": "monthly"}}', 1::smallint, '2026-01-01', '2026-05-31'),
  array['2026-01-31', '2026-03-31', '2026-05-31']::date[],
  'monthly on the 31st skips months without one');
select is(
  tests.dates('{"all_day": false, "starts_at": "2026-11-01T15:00:00Z",
    "repeat": {"freq": "daily", "count": 3}}', 1::smallint, '2026-11-02', '2026-11-10'),
  array['2026-11-02', '2026-11-03']::date[],
  'a count ends the series, counting from the first occurrence');
select is(
  tests.dates('{"all_day": false, "starts_at": "2026-11-01T15:00:00Z",
    "repeat": {"freq": "daily", "until": "2026-11-03"}}', 1::smallint, '2026-11-01', '2026-11-10'),
  array['2026-11-01', '2026-11-02', '2026-11-03']::date[],
  'until is the last date, inclusive');
select is(
  tests.dates('{"all_day": false, "starts_at": "2026-11-02T04:30:00Z"}', 1::smallint,
    '2026-11-01', '2026-11-01'),
  array['2026-11-01']::date[],
  'a single event''s date is its start in the household''s timezone');

-- ---------------------------------------------------------------------------
-- event_changed (FR2-REM-4)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, place, notes, starts_at, ends_at) values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'Pediatrician', 'Main St', 'Bring the red book', tests.ny(3, '10:00'), tests.ny(3, '11:00'));
reset role;

select is(tests.count('aaaaaaaa-0000-0000-0000-000000000002', 'event_changed'), 1,
  'the other parent hears about a new event this fortnight');
select is(tests.count('aaaaaaaa-0000-0000-0000-000000000001', 'event_changed'), 0,
  'the member who made the change does not');
select is(
  tests.count('aaaaaaaa-0000-0000-0000-000000000003', 'event_changed')
    + tests.count('aaaaaaaa-0000-0000-0000-000000000004', 'event_changed'), 0,
  'family members and caregivers hear nothing about an event not shared with them (D-16)');
select is(
  (select payload from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and type = 'event_changed'),
  jsonb_build_object('event_id', 'eeeeeeee-0000-0000-0000-000000000001', 'change', 'created',
    'kind', 'kind.appointment', 'date', tests.ny_date(3)),
  'the payload carries the event ID, the change, the kind and the date only');
select ok(
  (select deliver_at is not null from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and type = 'event_changed'),
  'it is pushed, after quiet hours');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.events set starts_at = tests.ny(4, '10:00'), ends_at = tests.ny(4, '11:00')
where id = 'eeeeeeee-0000-0000-0000-000000000001';
reset role;
select is(tests.count('aaaaaaaa-0000-0000-0000-000000000002', 'event_changed'), 1,
  'a second change to the same event within the hour adds nothing');

-- Title, place and notes edits, and events further away, aren't changes worth a push.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
insert into public.events (id, household_id, title, starts_at, ends_at) values
  ('eeeeeeee-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
   'School play', tests.ny(30, '10:00'), tests.ny(30, '11:00'));
update public.events set title = 'Dentist', notes = 'x'
where id = 'eeeeeeee-0000-0000-0000-000000000002';
reset role;
select is(tests.count('aaaaaaaa-0000-0000-0000-000000000001', 'event_changed'), 0,
  'nothing for an event more than 14 days away');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
insert into public.events (id, household_id, title, starts_at, ends_at) values
  ('eeeeeeee-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
   'Swim', tests.ny(5, '10:00'), tests.ny(5, '11:00'));
reset role;
delete from public.notifications;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.events set title = 'Swim lesson', place = 'Pool'
where id = 'eeeeeeee-0000-0000-0000-000000000003';
reset role;
select is(tests.count('aaaaaaaa-0000-0000-0000-000000000002', 'event_changed'), 0,
  'renaming an event is not a change notification');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.events set deleted_at = now() where id = 'eeeeeeee-0000-0000-0000-000000000003';
reset role;
select is(
  (select payload ->> 'change' from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and type = 'event_changed'),
  'cancelled', 'deleting an event is a cancellation');

-- Shared events reach family members and caregivers; their changes reach parents.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.events (id, household_id, kind, title, starts_at, ends_at, shared) values
  ('eeeeeeee-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a',
   'kind.childcare', 'Nanny', tests.ny(2, '08:00'), tests.ny(2, '17:00'), true);
reset role;
select is(
  tests.count('aaaaaaaa-0000-0000-0000-000000000003', 'event_changed')
    + tests.count('aaaaaaaa-0000-0000-0000-000000000004', 'event_changed'), 2,
  'family members and caregivers hear about a shared event');

delete from public.notifications;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000004');
insert into public.events (id, household_id, title, starts_at, ends_at, shared) values
  ('eeeeeeee-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a',
   'Playdate', tests.ny(1, '15:00'), tests.ny(1, '16:00'), true);
reset role;
select is(
  (select count(*)::integer from public.notifications where type = 'event_changed'), 3,
  'a caregiver''s new event reaches both parents and the family member');

-- One occurrence of a repeat skipped: a cancellation, about that date.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at, repeat) values
  ('eeeeeeee-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000a',
   'Therapy', tests.ny(-7, '09:00'), tests.ny(-7, '10:00'), '{"freq": "daily"}');
reset role;
delete from public.notifications;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.event_exceptions (id, household_id, event_id, original_date, status) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
   'eeeeeeee-0000-0000-0000-000000000006', tests.ny_date(2), 'skipped');
reset role;
select is(
  (select payload - 'event_id' from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and type = 'event_changed'),
  jsonb_build_object('change', 'cancelled', 'kind', 'kind.appointment', 'date', tests.ny_date(2)),
  'skipping one occurrence of a repeat is a cancellation of that day');

-- Free: no change notifications (D-15).
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at) values
  ('eeeeeeee-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b',
   'Dentist', now() + interval '2 days', now() + interval '2 days 1 hour');
reset role;
select is(tests.count('bbbbbbbb-0000-0000-0000-000000000002', 'event_changed'), 0,
  'a Free household gets no change notifications');

-- A member who turned the type off gets none.
delete from public.notifications;
insert into public.notification_prefs (user_id, event_changes)
values ('aaaaaaaa-0000-0000-0000-000000000002', false);
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.events set starts_at = tests.ny(6, '10:00'), ends_at = tests.ny(6, '11:00')
where id = 'eeeeeeee-0000-0000-0000-000000000004';
reset role;
select is(tests.count('aaaaaaaa-0000-0000-0000-000000000002', 'event_changed'), 0,
  'a member with change notifications off gets none');
select is(tests.count('aaaaaaaa-0000-0000-0000-000000000004', 'event_changed'), 1,
  'others still do');
delete from public.notification_prefs;

-- No title, place, notes or names in any payload.
select is_empty(
  $$select id from public.notifications
    where payload::text ~* '(pediatrician|main st|red book|nanny|playdate|therapy|swim)'$$,
  'no titles, places or notes reach a payload');

-- ---------------------------------------------------------------------------
-- Sending re-checks the tier and what the member can see (FR2-REM-6, D-16)
-- ---------------------------------------------------------------------------
update public.notifications set deliver_at = now() - interval '1 minute';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.events set shared = false where id = 'eeeeeeee-0000-0000-0000-000000000004';
reset role;
set local role service_role;
select is_empty(
  $$select id from public.claim_pushes()
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000004'$$,
  'a change about an event unshared since is not pushed');
reset role;

delete from public.notifications;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
update public.events set starts_at = tests.ny(7, '10:00'), ends_at = tests.ny(7, '11:00')
where id = 'eeeeeeee-0000-0000-0000-000000000001';
reset role;
update public.notifications set deliver_at = now() - interval '1 minute';
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
set local role service_role;
select is_empty($$select id from public.claim_pushes() where type = 'event_changed'$$,
  'after a lapse, queued change notifications are not pushed');
reset role;
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

-- Members read only their own notifications.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select is_empty($$select id from public.notifications where type = 'event_changed'
    and payload ->> 'event_id' = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  'a caregiver cannot read the parents'' change notifications');
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty(
  $$select id from public.notifications where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'another household''s members cannot read them');
reset role;

select * from finish();
rollback;
