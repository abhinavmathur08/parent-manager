-- C-01.3, R2-ACC-2, NFR2-OFF-2: visible_ids answers, through RLS, which rows of a scoped table a
-- member can see now, so their device can drop the rest after an unshare, a lapse or a removal.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'GB', 'en-GB', 'metric', 'Europe/London', 1),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'US', 'en-US', 'us_customary', 'America/Chicago', 7);
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at, shared) values
  ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Nursery',
   '2026-12-01 08:00+00', '2026-12-01 09:00+00', true),
  ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Health visitor',
   '2026-12-02 10:00+00', '2026-12-02 11:00+00', false),
  ('aaaaaaaa-7777-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Old',
   '2026-11-02 10:00+00', '2026-11-02 11:00+00', true);
update public.events set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000003';
insert into public.event_reminders (id, household_id, event_id, offset_minutes) values
  ('aaaaaaaa-8888-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-7777-0000-0000-000000000001', 60),
  ('aaaaaaaa-8888-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-7777-0000-0000-000000000002', 60);

reset role;
select is(
  (select array_agg(c.relname::text order by c.relname::text)
   from private.scoped_sync_tables t join pg_catalog.pg_class c on c.oid = t.table_name),
  array['event_exceptions', 'event_people', 'event_reminders', 'events'],
  'the calendar tables are scoped');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');

select is(
  public.visible_ids('events', '00000000-0000-0000-0000-00000000000a'),
  array['aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-7777-0000-0000-000000000002']::uuid[],
  'a parent sees every live event, and no tombstones');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  public.visible_ids('events', '00000000-0000-0000-0000-00000000000a'),
  array['aaaaaaaa-7777-0000-0000-000000000001']::uuid[],
  'a caregiver sees only the shared event');
select is(
  public.visible_ids('event_reminders', '00000000-0000-0000-0000-00000000000a'),
  array['aaaaaaaa-8888-0000-0000-000000000001']::uuid[],
  'and only its reminders');
select is(
  public.visible_ids('event_people', '00000000-0000-0000-0000-00000000000a'),
  '{}'::uuid[], 'an empty table gives an empty list, not null');
select throws_ok(
  $$select public.visible_ids('plan_entries', '00000000-0000-0000-0000-00000000000a')$$,
  '22023', null, 'only scoped tables can be asked about');
select throws_ok(
  $$select public.visible_ids('events; drop table public.events', '00000000-0000-0000-0000-00000000000a')$$,
  '22023', null, 'a table name is only ever a name');

-- Unshared: the caregiver's list loses the event and its reminder (R2-ACC-2).
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.events set shared = false where id = 'aaaaaaaa-7777-0000-0000-000000000001';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  public.visible_ids('events', '00000000-0000-0000-0000-00000000000a'),
  '{}'::uuid[], 'an unshared event leaves the caregiver''s list');
select is(
  public.visible_ids('event_reminders', '00000000-0000-0000-0000-00000000000a'),
  '{}'::uuid[], 'and so does its reminder');

-- A lapse to Free pauses the caregiver: every list is empty (FR-PAY-9).
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.events set shared = true where id = 'aaaaaaaa-7777-0000-0000-000000000001';
reset role;
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  public.visible_ids('events', '00000000-0000-0000-0000-00000000000a'),
  '{}'::uuid[], 'a lapse empties a caregiver''s list');

-- Removed: nothing, even back on Premium.
reset role;
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
update public.household_members set status = 'removed'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  public.visible_ids('events', '00000000-0000-0000-0000-00000000000a'),
  '{}'::uuid[], 'a removed member''s list is empty');

-- Another household's parent sees nothing of household A.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(
  public.visible_ids('events', '00000000-0000-0000-0000-00000000000a'),
  '{}'::uuid[], 'another household sees nothing');

reset role;
select ok(
  not has_function_privilege('anon', 'public.visible_ids(text, uuid)', 'execute'),
  'signed-out clients can''t call it');
select throws_ok(
  $$select private.enable_scoped_sync('public.app_config')$$,
  'P0001', null, 'only a synced table can be scoped');

select * from finish();
rollback;
