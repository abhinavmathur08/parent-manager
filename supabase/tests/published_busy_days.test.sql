-- B-01.4, R2-BUSY-2, NFR2-SEC-1 (D-22): published busy days hold only the date, busy or not and
-- a fixed reason; every active member reads them, only parents write, two parents publishing the
-- same day write one row, and no household reads or writes another's.
begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

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
    $q$select id from public.busy_days where household_id = '00000000-0000-0000-0000-00000000000b'$q$,
    label || ': cannot read household B''s busy days');
  return next is_empty(
    $q$update public.busy_days set busy = false, reason = null
       where household_id = '00000000-0000-0000-0000-00000000000b' returning id$q$,
    label || ': cannot change household B''s busy days');
  return next throws_ok(
    $q$insert into public.busy_days (id, household_id, date, busy, reason)
       values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', '2026-12-04', true, 'dinner')$q$,
    '42501', null, label || ': cannot publish a day in household B');
end;
$$;

-- Fixtures: household A (Premium: parents 1 and 4, family member 2, caregiver 3), household B
-- (Free: a parent).
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'a-parent-2@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'parent'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.busy_days (id, household_id, date, busy, reason) values
  ('bbbbbbbb-6666-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-12-02', true, 'booked');

-- ---------------------------------------------------------------------------
-- R2-BUSY-2: a row says no more than the marker. No titles, times, durations or event IDs.
-- ---------------------------------------------------------------------------
reset role;
select is(
  array(select column_name::text from information_schema.columns
        where table_schema = 'public' and table_name = 'busy_days' order by ordinal_position),
  array['id', 'household_id', 'date', 'busy', 'reason', 'version', 'created_at', 'updated_at',
        'deleted_at'],
  'busy_days holds only the date, busy and reason, plus sync columns');
select is(
  array(select column_name::text from information_schema.columns
        where table_schema = 'public' and table_name = 'busy_days'
          and data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY',
                            'USER-DEFINED', 'bytea')),
  array['reason'],
  'the fixed reason is the only text column');
select has_trigger('public', 'busy_days', 'sync_before_update', 'busy days sync');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into public.busy_days (id, household_id, date, busy, reason)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-09', true, 'Therapy 16:30')$$,
  '23514', null, 'the reason is a fixed identifier, never free text');
select throws_ok(
  $$insert into public.busy_days (id, household_id, date, busy, reason)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-09', true, null)$$,
  '23514', null, 'a busy day has a reason');
select throws_ok(
  $$insert into public.busy_days (id, household_id, date, busy, reason)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-09', false, 'dinner')$$,
  '23514', null, 'a day that isn''t busy has no reason');

-- ---------------------------------------------------------------------------
-- Parents publish; two parents publishing the same day write one row.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.busy_days (id, household_id, date, busy, reason)
    values ('aaaaaaaa-6666-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-12-02', true, 'dinner')$$,
  'a parent publishes a busy day');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select throws_ok(
  $$insert into public.busy_days (id, household_id, date, busy, reason)
    values ('aaaaaaaa-6666-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-12-02', true, 'dinner')$$,
  '23505', null, 'the other parent''s copy of the same day is the same row (the sync layer completes it)');
select throws_ok(
  $$insert into public.busy_days (id, household_id, date, busy, reason)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-02', false, null)$$,
  '23505', null, 'a day has one row');
select lives_ok(
  $$update public.busy_days set busy = false, reason = null where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
  'the other parent updates the day');
select throws_ok(
  $$update public.busy_days set deleted_at = now() where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
  '23514', null, 'a day is published as not busy, not deleted');
select throws_ok(
  $$update public.busy_days set date = '2026-12-03' where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
  '23514', null, 'a row keeps its day');
select throws_ok(
  $$delete from public.busy_days where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
  '42501', null, 'rows are never hard-deleted by a client');
update public.busy_days set busy = true, reason = 'booked' where id = 'aaaaaaaa-6666-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Family members and caregivers read every day, and write none.
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select results_eq(
  $$select date::text, busy, reason from public.busy_days$$,
  $$values ('2026-12-02', true, 'booked')$$,
  'a family member reads the published day');
select throws_ok(
  $$insert into public.busy_days (id, household_id, date, busy, reason)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-05', true, 'marked')$$,
  '42501', null, 'a family member cannot publish (they mark days through overrides)');
select is_empty(
  $$update public.busy_days set busy = false, reason = null
    where id = 'aaaaaaaa-6666-0000-0000-000000000001' returning id$$,
  'a family member cannot change a published day');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select results_eq(
  $$select date::text, busy, reason from public.busy_days$$,
  $$values ('2026-12-02', true, 'booked')$$,
  'a caregiver reads the published day');
select throws_ok(
  $$insert into public.busy_days (id, household_id, date, busy, reason)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-05', true, 'dinner')$$,
  '42501', null, 'a caregiver cannot publish');
select is_empty(
  $$update public.busy_days set busy = false, reason = null
    where id = 'aaaaaaaa-6666-0000-0000-000000000001' returning id$$,
  'a caregiver cannot change a published day');

-- ---------------------------------------------------------------------------
-- Household isolation, for every role (NFR2-SEC-1).
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select tests.cannot_reach_household_b('parent');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select tests.cannot_reach_household_b('family member');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select tests.cannot_reach_household_b('caregiver');

-- A removed member reads nothing.
reset role;
update public.household_members set status = 'removed'
where household_id = '00000000-0000-0000-0000-00000000000a'
  and user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty($$select id from public.busy_days$$, 'a removed member reads no busy days');

select * from finish();
rollback;
