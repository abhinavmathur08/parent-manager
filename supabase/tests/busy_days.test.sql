-- B-01.1, R2-BUSY-3, FR2-BUSY-4, FR2-DEV-5, FR2-DEV-6, NFR2-SEC-1: busy blocks hold no text,
-- only parents read every block, each member writes only their own, and parents and family
-- members (not caregivers) mark days. Neither table can be read or written across households.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

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
    $q$select id from public.busy_blocks where household_id = '00000000-0000-0000-0000-00000000000b'$q$,
    label || ': cannot read household B''s busy blocks');
  return next is_empty(
    $q$update public.busy_blocks set ends_at = ends_at + interval '1 hour'
       where household_id = '00000000-0000-0000-0000-00000000000b' returning id$q$,
    label || ': cannot change household B''s busy blocks');
  return next throws_ok(
    $q$insert into public.busy_blocks (id, household_id, user_id, starts_at, ends_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b',
               (select auth.uid()), '2026-12-02 06:00+00', '2026-12-02 07:00+00')$q$,
    '42501', null, label || ': cannot add a busy block to household B');
  return next is_empty(
    $q$select id from public.busy_day_overrides where household_id = '00000000-0000-0000-0000-00000000000b'$q$,
    label || ': cannot read household B''s overrides');
  return next is_empty(
    $q$update public.busy_day_overrides set busy = false
       where household_id = '00000000-0000-0000-0000-00000000000b' returning id$q$,
    label || ': cannot change household B''s overrides');
  return next throws_ok(
    $q$insert into public.busy_day_overrides (id, household_id, date, busy)
       values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', '2026-12-03', true)$q$,
    '42501', null, label || ': cannot mark a day in household B');
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
insert into public.busy_blocks (id, household_id, user_id, starts_at, ends_at) values
  ('bbbbbbbb-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'bbbbbbbb-0000-0000-0000-000000000001', '2026-12-02 06:00+00', '2026-12-02 07:00+00');
insert into public.busy_day_overrides (id, household_id, date, busy) values
  ('bbbbbbbb-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-12-02', true);

-- ---------------------------------------------------------------------------
-- R2-BUSY-3: a block is the member, start and end, and nothing else.
-- ---------------------------------------------------------------------------
reset role;
select is(
  array(select column_name::text from information_schema.columns
        where table_schema = 'public' and table_name = 'busy_blocks'
          and data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY',
                            'USER-DEFINED', 'bytea')),
  array[]::text[],
  'busy_blocks has no text columns (R2-BUSY-3)');
select is(
  array(select column_name::text from information_schema.columns
        where table_schema = 'public' and table_name = 'busy_blocks' order by ordinal_position),
  array['id', 'household_id', 'user_id', 'starts_at', 'ends_at', 'version', 'created_at',
        'updated_at', 'deleted_at'],
  'busy_blocks holds only the member, start and end, plus sync columns');
select has_trigger('public', 'busy_blocks', 'sync_before_update', 'busy blocks sync');
select has_trigger('public', 'busy_day_overrides', 'sync_before_update', 'overrides sync');
select ok(
  (select value ? 'booked_minutes' from public.app_config where key = 'calendar.busy_rule'),
  'the busy-day thresholds are a server setting (R2-PAY-1)');

-- ---------------------------------------------------------------------------
-- Busy blocks: each member writes their own; parents read all (C9).
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.busy_blocks (id, household_id, user_id, starts_at, ends_at)
    values ('aaaaaaaa-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-0000-0000-0000-000000000001', '2026-12-02 21:00+00', '2026-12-02 22:00+00')$$,
  'a parent shares a busy block');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.busy_blocks (id, household_id, user_id, starts_at, ends_at)
    values ('aaaaaaaa-5555-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-0000-0000-0000-000000000002', '2026-12-02 14:00+00', '2026-12-02 15:00+00')$$,
  'a family member shares a busy block');
select throws_ok(
  $$insert into public.busy_blocks (id, household_id, user_id, starts_at, ends_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-0000-0000-0000-000000000002', '2026-12-02 15:00+00', '2026-12-02 14:00+00')$$,
  '23514', null, 'a block ends after it starts');
select throws_ok(
  $$insert into public.busy_blocks (id, household_id, user_id, starts_at, ends_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-0000-0000-0000-000000000002', '2026-12-02 00:00+00', '2026-12-04 00:00+00')$$,
  '23514', null, 'a block is at most a day long');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
insert into public.busy_blocks (id, household_id, user_id, starts_at, ends_at) values
  -- Naming another member is ignored: the server sets the writer.
  ('aaaaaaaa-5555-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-0000-0000-0000-000000000001', '2026-12-03 14:00+00', '2026-12-03 15:00+00');
select is(
  (select user_id from public.busy_blocks where id = 'aaaaaaaa-5555-0000-0000-000000000003'),
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'a block always belongs to the member who wrote it');
select is(
  array(select id from public.busy_blocks order by id),
  array['aaaaaaaa-5555-0000-0000-000000000003'::uuid],
  'a caregiver reads only their own blocks');
select is_empty(
  $$update public.busy_blocks set ends_at = ends_at + interval '1 hour'
    where id = 'aaaaaaaa-5555-0000-0000-000000000002' returning id$$,
  'a caregiver cannot change another member''s block');
select throws_ok(
  $$update public.busy_blocks set user_id = 'aaaaaaaa-0000-0000-0000-000000000002'
    where id = 'aaaaaaaa-5555-0000-0000-000000000003'$$,
  '23514', null, 'a block cannot move to another member');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select is(
  array(select id from public.busy_blocks order by id),
  array['aaaaaaaa-5555-0000-0000-000000000002'::uuid],
  'a family member reads only their own blocks (C9)');
select is(
  public.visible_ids('busy_blocks', '00000000-0000-0000-0000-00000000000a'),
  array['aaaaaaaa-5555-0000-0000-000000000002'::uuid],
  'scoped sync gives a family member only their own blocks');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select count(*)::integer from public.busy_blocks),
  3,
  'a parent reads every member''s blocks (C9, FR2-DEV-6)');
select is_empty(
  $$update public.busy_blocks set deleted_at = now()
    where id = 'aaaaaaaa-5555-0000-0000-000000000002' returning id$$,
  'a parent cannot change or delete another member''s block');
select throws_ok(
  $$delete from public.busy_blocks where id = 'aaaaaaaa-5555-0000-0000-000000000001'$$,
  '42501', null, 'blocks are never hard-deleted by a client');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select isnt_empty(
  $$update public.busy_blocks set deleted_at = now()
    where id = 'aaaaaaaa-5555-0000-0000-000000000002' returning id$$,
  'a member deletes their own block (turning busy times off, FR2-DEV-5)');

-- ---------------------------------------------------------------------------
-- Overrides: parents and family members mark days; caregivers see the marks (C8).
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.busy_day_overrides (id, household_id, date, busy)
    values ('aaaaaaaa-4444-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-12-02', true)$$,
  'a parent marks a day busy');
select throws_ok(
  $$insert into public.busy_day_overrides (id, household_id, date, busy)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-02', false)$$,
  '23505', null, 'a day has one override row');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok(
  $$update public.busy_day_overrides set busy = false where id = 'aaaaaaaa-4444-0000-0000-000000000001'$$,
  'a family member marks it not busy');
select is(
  (select set_by from public.busy_day_overrides where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'the server records who set the mark');
select lives_ok(
  $$insert into public.busy_day_overrides (id, household_id, date, busy)
    values ('aaaaaaaa-4444-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '2026-12-03', true)$$,
  'a family member marks a day busy');
select lives_ok(
  $$update public.busy_day_overrides set busy = null where id = 'aaaaaaaa-4444-0000-0000-000000000002'$$,
  'a mark is cleared by setting busy to null');
select throws_ok(
  $$update public.busy_day_overrides set deleted_at = now() where id = 'aaaaaaaa-4444-0000-0000-000000000002'$$,
  '23514', null, 'a mark is cleared, not deleted');
select throws_ok(
  $$update public.busy_day_overrides set date = '2026-12-04' where id = 'aaaaaaaa-4444-0000-0000-000000000002'$$,
  '23514', null, 'a mark keeps its day');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select count(*)::integer from public.busy_day_overrides),
  2,
  'a caregiver sees the marks');
select throws_ok(
  $$insert into public.busy_day_overrides (id, household_id, date, busy)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-05', true)$$,
  '42501', null, 'a caregiver cannot mark a day (C8)');
select is_empty(
  $$update public.busy_day_overrides set busy = true
    where id = 'aaaaaaaa-4444-0000-0000-000000000001' returning id$$,
  'a caregiver cannot change a mark (C8)');

-- ---------------------------------------------------------------------------
-- Household isolation, for every role (NFR2-SEC-1).
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select tests.cannot_reach_household_b('parent');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select tests.cannot_reach_household_b('family member');

-- ---------------------------------------------------------------------------
-- Removal deletes the member's blocks from the server at once (FR2-DEV-5).
-- ---------------------------------------------------------------------------
reset role;
update public.household_members set status = 'removed'
where household_id = '00000000-0000-0000-0000-00000000000a'
  and user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
select isnt(
  (select deleted_at from public.busy_blocks where id = 'aaaaaaaa-5555-0000-0000-000000000003'),
  null,
  'a removed member''s busy blocks are deleted');
select is(
  (select deleted_at from public.busy_blocks where id = 'aaaaaaaa-5555-0000-0000-000000000001'),
  null,
  'other members'' blocks stay');

select * from finish();
rollback;
