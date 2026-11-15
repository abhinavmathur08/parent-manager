-- N-02.2 (FR-NOT-4, NFR-SEC-2): "list is ready" reaches the other members once per list per
-- day, whichever trigger comes first; list-ready events are isolated per household.
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

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a2@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b1@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');
-- Joining notices aren't what this tests.
delete from public.notifications;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(public.announce_list_ready('2026-11-15', 'button'), 'sent', 'a member announces the list');
select is(public.announce_list_ready('2026-11-15', 'week_planned'), 'already_sent',
  'the automatic trigger the same day sends nothing more');
reset role;
select results_eq(
  $$select user_id, type, payload from public.notifications$$,
  $$values ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'list_ready', '{"week_start": "2026-11-15"}'::jsonb)$$,
  'only the other member gets it, with no list contents');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select is(public.announce_list_ready('2026-11-15', 'button'), 'already_sent',
  'the partner announcing the same list the same day sends nothing more');
select is(public.announce_list_ready('2026-11-22', 'week_planned'), 'sent',
  'another week''s list is another list');
select results_eq(
  $$select week_start, trigger from public.list_ready_events order by week_start$$,
  $$values ('2026-11-15'::date, 'button'), ('2026-11-22'::date, 'week_planned')$$,
  'members see their household''s announcements');
select throws_ok(
  $$insert into public.list_ready_events (household_id, week_start, local_date, trigger)
    values ('00000000-0000-0000-0000-00000000000a', '2026-11-29', '2026-11-15', 'button')$$,
  '42501', null, 'members cannot write events directly');
select throws_ok($$select public.announce_list_ready('2026-11-29', 'nope')$$, '22023', null,
  'the trigger must be known');
reset role;

-- The next day in the household's timezone, the same list can be announced again.
update public.list_ready_events set local_date = local_date - 1;
update public.notifications set dedupe_key = dedupe_key || ':yesterday';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(public.announce_list_ready('2026-11-15', 'button'), 'sent', 'once per list per day');
reset role;
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and type = 'list_ready'),
  2, 'so the partner has heard twice, a day apart');

-- A member who turned the type off isn't sent it (FR-NOT-7).
insert into public.notification_prefs (user_id, list_ready) values ('aaaaaaaa-0000-0000-0000-000000000002', false);
update public.list_ready_events set local_date = local_date - 1;
update public.notifications set dedupe_key = dedupe_key || ':yesterday';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(public.announce_list_ready('2026-11-15', 'button'), 'sent', 'announced again');
reset role;
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and type = 'list_ready'),
  2, 'but not to a member with the type off');

-- Export (FR-PRIV-2)
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  jsonb_array_length(public.export_household_data('00000000-0000-0000-0000-00000000000a') -> 'tables' -> 'list_ready_events'),
  4, 'the household export includes all four of its list announcements');
reset role;

-- Isolation
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty($$select week_start from public.list_ready_events$$,
  'another household cannot see the announcements');
select is(public.announce_list_ready('2026-11-16', 'button'), 'sent',
  'and announces only its own list');
reset role;
select is(
  (select count(*)::int from public.notifications where household_id = '00000000-0000-0000-0000-00000000000b'),
  0, 'a household of one has no one to tell');

set local role anon;
select throws_ok($$select public.announce_list_ready('2026-11-15', 'button')$$, '42501', null,
  'anonymous callers cannot announce');

select * from finish();
rollback;
