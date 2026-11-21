-- C-01.2, FR2-CAL-4, R2-CAL-2, NFR2-SEC-1: event_exceptions are isolated per household for every
-- role, follow their event's visibility, hold one row per occurrence, are restored rather than
-- deleted, and are tombstoned with their event.
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

create function tests.cannot_reach_household_b(label text)
returns setof text language plpgsql as $$
begin
  return next is_empty(
    $q$select id from public.event_exceptions where household_id = '00000000-0000-0000-0000-00000000000b'$q$,
    label || ': cannot read household B''s exceptions');
  return next is_empty(
    $q$update public.event_exceptions set status = 'restored'
       where household_id = '00000000-0000-0000-0000-00000000000b' returning id$q$,
    label || ': cannot change household B''s exceptions');
  return next throws_ok(
    $q$insert into public.event_exceptions (id, household_id, event_id, original_date, status)
       values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b',
               'bbbbbbbb-7777-0000-0000-000000000001', '2026-12-08', 'skipped')$q$,
    '42501', null, label || ': cannot add an exception to household B''s event');
end;
$$;

-- Fixtures: household A (Premium: parent, family member, caregiver), household B (Free: parent).
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at, repeat) values
  ('bbbbbbbb-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Swim',
   '2026-12-01 07:00+00', '2026-12-01 08:00+00', '{"freq": "weekly", "weekdays": [2]}');
insert into public.event_exceptions (id, household_id, event_id, original_date, status) values
  ('bbbbbbbb-6666-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'bbbbbbbb-7777-0000-0000-000000000001', '2026-12-08', 'skipped');

-- A parent's weekly unshared event, a shared all-day one, and a single event.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at, repeat, shared) values
  ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Daycare pickup',
   '2026-11-30 22:00+00', '2026-11-30 22:30+00', '{"freq": "weekly", "weekdays": [1]}', false),
  ('aaaaaaaa-7777-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'One-off',
   '2026-11-30 15:00+00', '2026-11-30 16:00+00', null, true);
insert into public.events (id, household_id, title, all_day, start_date, end_date, repeat, shared) values
  ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Nanny day', true,
   '2026-12-02', '2026-12-02', '{"freq": "weekly", "weekdays": [3]}', true);

select has_trigger('public', 'event_exceptions', 'sync_before_update', 'exceptions sync');

select lives_ok(
  $$insert into public.event_exceptions (id, household_id, event_id, original_date, status, starts_at, ends_at)
    values ('aaaaaaaa-6666-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', '2026-12-07', 'moved',
            '2026-12-07 22:30+00', '2026-12-07 23:00+00')$$,
  'a parent moves one occurrence ("this event")');
select throws_ok(
  $$insert into public.event_exceptions (id, household_id, event_id, original_date, status)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', '2026-12-07', 'skipped')$$,
  '23505', null, 'an occurrence has one exception row (R2-CAL-2)');
select throws_ok(
  $$insert into public.event_exceptions (id, household_id, event_id, original_date, status, start_date, end_date)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', '2026-12-14', 'moved', '2026-12-15', '2026-12-15')$$,
  '23514', null, 'a timed series'' occurrence moves to new times, not dates');
select throws_ok(
  $$insert into public.event_exceptions (id, household_id, event_id, original_date, status, starts_at, ends_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', '2026-12-14', 'skipped', now(), now())$$,
  '23514', null, 'a skipped occurrence has no times');
select throws_ok(
  $$insert into public.event_exceptions (id, household_id, event_id, original_date, status)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000003', '2026-11-30', 'skipped')$$,
  '23514', null, 'a single event has no exceptions');
select throws_ok(
  $$insert into public.event_exceptions (id, household_id, event_id, original_date, status, taking_user_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', '2026-12-14', 'skipped',
            'bbbbbbbb-0000-0000-0000-000000000001')$$,
  '23514', null, 'the taking member must be in the household');
select lives_ok(
  $$insert into public.event_exceptions (id, household_id, event_id, original_date, status, start_date, end_date)
    values ('aaaaaaaa-6666-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', '2026-12-09', 'moved', '2026-12-10', '2026-12-10')$$,
  'an all-day occurrence moves to another date');
select throws_ok(
  $$update public.event_exceptions set original_date = '2026-12-14'
    where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
  '23514', null, 'an exception keeps its occurrence');
select throws_ok(
  $$update public.event_exceptions set deleted_at = now()
    where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
  '23514', null, 'an exception is restored, not deleted');
select isnt_empty(
  $$update public.event_exceptions set status = 'restored', starts_at = null, ends_at = null
    where id = 'aaaaaaaa-6666-0000-0000-000000000001' returning id$$,
  'undoing a change restores the occurrence');
select isnt_empty(
  $$update public.event_exceptions set status = 'skipped'
    where id = 'aaaaaaaa-6666-0000-0000-000000000001' returning id$$,
  'and the same row can skip it later');

select * from tests.cannot_reach_household_b('parent');

-- A family member sees exceptions of shared events only, and can't change a parent's series.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select results_eq(
  $$select id from public.event_exceptions$$,
  $$values ('aaaaaaaa-6666-0000-0000-000000000002'::uuid)$$,
  'a family member sees only the shared event''s exceptions');
select throws_ok(
  $$insert into public.event_exceptions (id, household_id, event_id, original_date, status)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', '2026-12-16', 'skipped')$$,
  '42501', null, 'a family member can''t skip an occurrence of a parent''s event');
select * from tests.cannot_reach_household_b('family member');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty(
  $$update public.event_exceptions set status = 'restored', start_date = null, end_date = null
    where id = 'aaaaaaaa-6666-0000-0000-000000000002' returning id$$,
  'a caregiver can''t change a parent''s exception');
select * from tests.cannot_reach_household_b('caregiver');

-- Deleting the series tombstones its exceptions.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$update public.events set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
  'a parent deletes the series');
select isnt(
  (select deleted_at from public.event_exceptions where id = 'aaaaaaaa-6666-0000-0000-000000000001'),
  null, 'its exceptions are deleted, as tombstones');

select * from finish();
rollback;
