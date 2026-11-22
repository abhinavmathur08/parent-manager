-- C-01.1, FR2-CAL-3, FR2-REM-1, FR2-PAY-2, R2-CAL-1, NFR2-SEC-1, D-16: events, event_people and
-- event_reminders are isolated per household for every role; parents see every event, family
-- members and caregivers see only shared ones and never change `shared`; they edit only the
-- events they created, and set "taking" to themselves on others; the server allows 1 reminder per
-- event on Free and 5 on Premium; deleting an event or a person tombstones the rows that hang on it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(90);

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
  b_event constant uuid := 'bbbbbbbb-7777-0000-0000-000000000001';
  b_person constant uuid := 'bbbbbbbb-5555-0000-0000-000000000001';
begin
  return next is_empty(
    format('select id from public.events where household_id = %L', b),
    label || ': cannot read household B''s events');
  return next is_empty(
    format('select id from public.event_people where household_id = %L', b),
    label || ': cannot read household B''s event people');
  return next is_empty(
    format('select id from public.event_reminders where household_id = %L', b),
    label || ': cannot read household B''s reminders');
  return next is_empty(
    format('update public.events set title = %L where household_id = %L returning id', 'Hacked', b),
    label || ': cannot edit household B''s events');
  return next throws_ok(
    format($q$insert into public.events (id, household_id, title, starts_at, ends_at, shared)
      values (gen_random_uuid(), %L, 'Intruder', now(), now(), true)$q$, b), '42501', null,
    label || ': cannot add an event to household B');
  return next throws_ok(
    format($q$insert into public.event_people (id, household_id, event_id, person_id)
      values (gen_random_uuid(), %L, %L, %L)$q$, b, b_event, b_person), '42501', null,
    label || ': cannot add a person to household B''s event');
  return next throws_ok(
    format($q$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
      values (gen_random_uuid(), %L, %L, 15)$q$, b, b_event), '42501', null,
    label || ': cannot add a reminder to household B''s event');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (Premium: parent, family member, caregiver), household B (Free: parent).
-- ---------------------------------------------------------------------------
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

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

insert into public.household_people (id, household_id, display_name, kind, age_band) values
  ('aaaaaaaa-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Baby', 'child', 'infant_0_6m'),
  ('aaaaaaaa-5555-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Alex', 'adult', 'adult'),
  ('bbbbbbbb-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Sam', 'adult', 'adult');

-- Household B's event, written by its parent.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at) values
  ('bbbbbbbb-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Dentist',
   '2026-11-24 10:00+00', '2026-11-24 11:00+00');
insert into public.event_people (id, household_id, event_id, person_id) values
  ('bbbbbbbb-9999-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'bbbbbbbb-7777-0000-0000-000000000001', 'bbbbbbbb-5555-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Structure and sync rules (FR2-CAL-6)
-- ---------------------------------------------------------------------------
select has_trigger('public', 'events', 'sync_before_update', 'events sync');
select has_trigger('public', 'event_people', 'sync_before_update', 'event people sync');
select has_trigger('public', 'event_reminders', 'sync_before_update', 'event reminders sync');
select col_type_is('public', 'events', 'starts_at', 'timestamp with time zone', 'a timed event starts at an instant');
select col_type_is('public', 'events', 'start_date', 'date', 'an all-day event starts on a date');

-- ---------------------------------------------------------------------------
-- Household B, on Free: 1 reminder per event (FR2-REM-1, FR2-PAY-2, D-15)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values ('bbbbbbbb-8888-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
            'bbbbbbbb-7777-0000-0000-000000000001', 1440)$$,
  'a free household sets a reminder');
select throws_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b',
            'bbbbbbbb-7777-0000-0000-000000000001', 60)$$,
  '23514', 'the event has the most reminders allowed',
  'the server refuses a second reminder on a free household');
select lives_ok(
  $$update public.event_reminders set offset_minutes = 60
    where id = 'bbbbbbbb-8888-0000-0000-000000000001'$$,
  'the one reminder can be changed');

-- ---------------------------------------------------------------------------
-- A parent plans (FR2-CAL-2, FR2-CAL-3)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.events (id, household_id, kind, title, starts_at, ends_at, place, notes)
    values ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
            'kind.appointment', 'Pediatrician', '2026-11-24 15:00+00', '2026-11-24 16:00+00',
            'Main St clinic', 'Bring the red book')$$,
  'a parent adds an unshared appointment');
select lives_ok(
  $$insert into public.events (id, household_id, kind, title, all_day, start_date, end_date, shared)
    values ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
            'kind.childcare', 'Grandma has the baby', true, '2026-11-25', '2026-11-26', true)$$,
  'a parent adds a shared all-day event');
select is(
  (select created_by from public.events where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the server records who created it');
select is(
  (select version from public.events where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  1, 'the server sets the first version');
select throws_ok(
  $$insert into public.events (id, household_id, title, starts_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'No end', now())$$,
  '23514', null, 'a timed event needs an end');
select throws_ok(
  $$insert into public.events (id, household_id, title, starts_at, ends_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Backwards',
            '2026-11-24 15:00+00', '2026-11-24 14:00+00')$$,
  '23514', null, 'a timed event can''t end before it starts');
select throws_ok(
  $$insert into public.events (id, household_id, title, all_day, start_date, end_date, starts_at, ends_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Both', true,
            '2026-11-24', '2026-11-24', now(), now())$$,
  '23514', null, 'an all-day event has dates, not instants');
select throws_ok(
  $$insert into public.events (id, household_id, kind, title, starts_at, ends_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Appointment', 'Free text kind',
            now(), now())$$,
  '23514', null, 'the kind is a fixed identifier');
select throws_ok(
  $$insert into public.events (id, household_id, title, starts_at, ends_at, taking_user_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Wrong taker', now(), now(),
            'bbbbbbbb-0000-0000-0000-000000000001')$$,
  '23514', null, 'the taking member must be in the household');
select isnt_empty(
  $$update public.events set taking_user_id = 'aaaaaaaa-0000-0000-0000-000000000002', version = 1
    where id = 'aaaaaaaa-7777-0000-0000-000000000002' returning id$$,
  'a parent sets who is taking');

select lives_ok(
  $$insert into public.event_people (id, household_id, event_id, person_id) values
    ('aaaaaaaa-9999-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000001'),
    ('aaaaaaaa-9999-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000002', 'aaaaaaaa-5555-0000-0000-000000000001'),
    ('aaaaaaaa-9999-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000002', 'aaaaaaaa-5555-0000-0000-000000000002')$$,
  'a parent says who events are for');
select throws_ok(
  $$insert into public.event_people (id, household_id, event_id, person_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000001')$$,
  '23505', null, 'a person is on an event once');
select throws_ok(
  $$insert into public.event_people (id, household_id, event_id, person_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', 'bbbbbbbb-5555-0000-0000-000000000001')$$,
  '23514', null, 'an event can''t name another household''s person');
select throws_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'bbbbbbbb-7777-0000-0000-000000000001', 15)$$,
  '42501', null, 'a reminder can''t point at another household''s event');

-- Premium: up to 5 reminders (D-15).
select lives_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes) values
    ('aaaaaaaa-8888-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', 0),
    ('aaaaaaaa-8888-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', 15),
    ('aaaaaaaa-8888-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', 60),
    ('aaaaaaaa-8888-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', 1440),
    ('aaaaaaaa-8888-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', 2880)$$,
  'a Premium household sets 5 reminders on an event');
select throws_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', 30)$$,
  '23514', null, 'a reminder offset is one of the five');
select lives_ok(
  $$update public.event_reminders set deleted_at = now()
    where id = 'aaaaaaaa-8888-0000-0000-000000000005'$$,
  'a reminder is removed with a tombstone');
select lives_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values ('aaaaaaaa-8888-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', 2880)$$,
  'a removed reminder frees its place and its offset');
select throws_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 0),
           (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 15),
           (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 60),
           (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 1440),
           (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 2880),
           (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', 0)$$,
  '23514', null, 'a sixth reminder is refused on Premium');
select lives_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values ('aaaaaaaa-8888-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 1440)$$,
  'the shared event gets a reminder');

select throws_ok(
  $$delete from public.events where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
  '42501', null, 'events can''t be hard-deleted');

select * from tests.cannot_reach_household_b('parent');

-- ---------------------------------------------------------------------------
-- A family member sees and changes only shared events (D-16, spec section 2, C2 to C6)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');

select results_eq(
  $$select id from public.events order by id$$,
  $$values ('aaaaaaaa-7777-0000-0000-000000000002'::uuid)$$,
  'a family member sees only the shared event');
select results_eq(
  $$select id from public.event_people order by id$$,
  $$values ('aaaaaaaa-9999-0000-0000-000000000002'::uuid), ('aaaaaaaa-9999-0000-0000-000000000003'::uuid)$$,
  'and only the shared event''s people');
select results_eq(
  $$select id from public.event_reminders order by id$$,
  $$values ('aaaaaaaa-8888-0000-0000-000000000007'::uuid)$$,
  'and only the shared event''s reminders');
select throws_ok(
  $$insert into public.events (id, household_id, title, starts_at, ends_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Private', now(), now())$$,
  '42501', null, 'a family member can''t add an unshared event');
select lives_ok(
  $$insert into public.events (id, household_id, kind, title, starts_at, ends_at, shared)
    values ('aaaaaaaa-7777-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
            'kind.family', 'Swim class', '2026-11-27 17:00+00', '2026-11-27 18:00+00', true)$$,
  'a family member adds a shared event');
select isnt_empty(
  $$update public.events set title = 'Swim lesson', version = 1
    where id = 'aaaaaaaa-7777-0000-0000-000000000003' returning id$$,
  'a family member edits an event they created');
select throws_ok(
  $$update public.events set shared = false where id = 'aaaaaaaa-7777-0000-0000-000000000003'$$,
  '42501', null, 'a family member can''t unshare even their own event');
select lives_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000003', 60)$$,
  'a family member sets a reminder on their own event');
select throws_ok(
  $$update public.events set title = 'Changed' where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', null, 'a family member can''t edit a parent''s event');
select throws_ok(
  $$update public.events set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', null, 'a family member can''t delete a parent''s event');
select throws_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 60)$$,
  '42501', null, 'a family member can''t add a reminder to a parent''s event');
select throws_ok(
  $$update public.events set taking_user_id = 'aaaaaaaa-0000-0000-0000-000000000003'
    where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', null, 'a family member can''t make someone else the taking member');
select isnt_empty(
  $$update public.events set taking_user_id = null
    where id = 'aaaaaaaa-7777-0000-0000-000000000002' returning id$$,
  'a family member who was taking can step back to "nobody yet"');
select is_empty(
  $$update public.events set title = 'Peek' where id = 'aaaaaaaa-7777-0000-0000-000000000001' returning id$$,
  'a family member can''t touch an unshared event');

select * from tests.cannot_reach_household_b('family member');

-- ---------------------------------------------------------------------------
-- A caregiver sees only shared events and takes the baby (C6)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');

select results_eq(
  $$select id from public.events order by id$$,
  $$values ('aaaaaaaa-7777-0000-0000-000000000002'::uuid), ('aaaaaaaa-7777-0000-0000-000000000003'::uuid)$$,
  'a caregiver sees only shared events');
select isnt_empty(
  $$update public.events set taking_user_id = 'aaaaaaaa-0000-0000-0000-000000000003'
    where id = 'aaaaaaaa-7777-0000-0000-000000000002' returning id$$,
  'a caregiver sets "taking" to themself on a parent''s shared event');
select throws_ok(
  $$update public.events set taking_user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', null, 'a caregiver can''t make someone else the taking member');
select throws_ok(
  $$update public.events set shared = false where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', null, 'a caregiver can''t unshare an event');
select throws_ok(
  $$update public.events set title = 'Mine now' where id = 'aaaaaaaa-7777-0000-0000-000000000003'$$,
  '42501', null, 'a caregiver can''t edit a family member''s event');
select throws_ok(
  $$update public.events set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', null, 'a caregiver can''t delete a parent''s event (C-03.2)');
select isnt_empty(
  $$update public.events set taking_user_id = null
    where id = 'aaaaaaaa-7777-0000-0000-000000000002' returning id$$,
  'a caregiver who took an event can step back to "nobody yet" (C-03.2)');
select is_empty(
  $$select id from public.event_people where event_id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
  'a caregiver can''t read who an unshared event is for');
select lives_ok(
  $$insert into public.events (id, household_id, kind, title, starts_at, ends_at, shared)
    values ('aaaaaaaa-7777-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a',
            'kind.childcare', 'Park', '2026-11-28 14:00+00', '2026-11-28 15:00+00', true)$$,
  'a caregiver adds a shared event');
select isnt_empty(
  $$update public.events set deleted_at = now(), version = 1
    where id = 'aaaaaaaa-7777-0000-0000-000000000004' returning id$$,
  'a caregiver deletes an event they created');

select * from tests.cannot_reach_household_b('caregiver');

-- ---------------------------------------------------------------------------
-- A parent unshares, deletes and removes a person
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select isnt_empty(
  $$update public.events set shared = false where id = 'aaaaaaaa-7777-0000-0000-000000000002' returning id$$,
  'a parent unshares an event');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select results_eq(
  $$select id from public.events where deleted_at is null order by id$$,
  $$values ('aaaaaaaa-7777-0000-0000-000000000003'::uuid)$$,
  'the caregiver no longer sees the unshared event');
select is_empty(
  $$select id from public.event_reminders where event_id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  'nor its reminders');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$update public.events set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
  'a parent deletes an event');
select is(
  (select count(*)::int from public.event_reminders
   where event_id = 'aaaaaaaa-7777-0000-0000-000000000001' and deleted_at is null),
  0, 'its reminders are deleted, as tombstones');
select is(
  (select count(*)::int from public.event_people
   where event_id = 'aaaaaaaa-7777-0000-0000-000000000001' and deleted_at is not null),
  1, 'its people are deleted, as tombstones');
select lives_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values ('aaaaaaaa-8888-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', 15)$$,
  'a reminder added offline to a deleted event is accepted');
select isnt(
  (select deleted_at from public.event_reminders where id = 'aaaaaaaa-8888-0000-0000-000000000009'),
  null, 'and arrives deleted');

select lives_ok(
  $$update public.household_people set deleted_at = now() where id = 'aaaaaaaa-5555-0000-0000-000000000002'$$,
  'a parent removes a person from the household');
select is(
  (select count(*)::int from public.event_people
   where person_id = 'aaaaaaaa-5555-0000-0000-000000000002' and deleted_at is null),
  0, 'the person leaves every event');
select is(
  (select count(*)::int from public.events
   where id = 'aaaaaaaa-7777-0000-0000-000000000002' and deleted_at is null),
  1, 'and the events stay');

-- ---------------------------------------------------------------------------
-- A lapse to Free (FR-PAY-9, FR2-REM-6)
-- ---------------------------------------------------------------------------
reset role;
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty($$select id from public.events$$, 'a caregiver sees no events after a lapse');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select is_empty($$select id from public.event_reminders$$, 'nor does a family member see reminders');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.event_reminders
   where event_id = 'aaaaaaaa-7777-0000-0000-000000000002' and deleted_at is null),
  1, 'reminders set on Premium are kept');
select throws_ok(
  $$insert into public.event_reminders (id, household_id, event_id, offset_minutes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 60)$$,
  '23514', null, 'but a second one is refused on Free');

-- ---------------------------------------------------------------------------
-- Export (FR2-PRIV-1)
-- ---------------------------------------------------------------------------
select ok(
  (select (public.export_household_data('00000000-0000-0000-0000-00000000000a') -> 'tables')
     ?& array['events', 'event_people', 'event_reminders']),
  'the household export has events, their people and their reminders');

select * from finish();
rollback;
