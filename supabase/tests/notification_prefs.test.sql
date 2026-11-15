-- N-01.2 (FR-NOT-6, FR-NOT-7, NFR-SEC-2): notification settings belong to one user, default
-- sensibly when missing, and quiet hours hold a push until they end in the household's
-- timezone.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

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
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b@example.test', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- Defaults (FR-NOT-1, FR-NOT-3, FR-NOT-6)
-- ---------------------------------------------------------------------------
select ok(
  (select p.plan_week and p.list_ready and p.defrost and p.household_changes
   from private.notification_prefs_of('aaaaaaaa-0000-0000-0000-000000000001') p),
  'every type is on until the member changes it');
select row_eq(
  $$select plan_week_day, plan_week_minute, quiet_start_minute, quiet_end_minute
    from private.notification_prefs_of('aaaaaaaa-0000-0000-0000-000000000001')$$,
  row(null::smallint, 1080::smallint, 1260::smallint, 420::smallint),
  'plan your week defaults to 18:00 the day before, quiet hours to 21:00-07:00');

-- ---------------------------------------------------------------------------
-- Own row only (FR-NOT-7)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.notification_prefs (user_id, list_ready, quiet_start_minute)
    values ('aaaaaaaa-0000-0000-0000-000000000001', false, 1320)$$,
  'a member saves their settings');
select lives_ok(
  $$insert into public.notification_prefs (user_id, list_ready)
    values ('aaaaaaaa-0000-0000-0000-000000000001', true)
    on conflict (user_id) do update set list_ready = excluded.list_ready$$,
  'and saves them again as an upsert');
select is(
  (select list_ready from public.notification_prefs), true, 'they read their own settings');
select throws_ok(
  $$insert into public.notification_prefs (user_id) values ('bbbbbbbb-0000-0000-0000-000000000001')$$,
  '42501', null, 'a member cannot create settings for someone else');
select throws_ok(
  $$update public.notification_prefs set quiet_end_minute = 1440$$, '23514', null,
  'times stay within a day');
select throws_ok(
  $$update public.notification_prefs set plan_week_day = 8$$, '23514', null,
  'the reminder day is an ISO weekday');
select throws_ok(
  $$delete from public.notification_prefs$$, '42501', null, 'settings are not deleted by members');

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty($$select user_id from public.notification_prefs$$,
  'another user cannot read them');
select is_empty(
  $$update public.notification_prefs set list_ready = false returning user_id$$,
  'another user cannot change them');
select throws_ok(
  $$insert into public.notification_prefs (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001')
    on conflict (user_id) do update set list_ready = false$$,
  '42501', null, 'another user cannot overwrite them with an upsert');
reset role;
select is(
  (select p.list_ready from private.notification_prefs_of('aaaaaaaa-0000-0000-0000-000000000001') p),
  true, 'the server reads the saved settings');

-- ---------------------------------------------------------------------------
-- Quiet hours (FR-NOT-6)
-- ---------------------------------------------------------------------------
-- 21:00-07:00 in New York.
select is(
  private.quiet_hours_release('2026-11-20 18:00-05', 'America/New_York', 1260, 420),
  '2026-11-20 18:00-05'::timestamptz, 'outside quiet hours a push goes at once');
select is(
  private.quiet_hours_release('2026-11-20 22:30-05', 'America/New_York', 1260, 420),
  '2026-11-21 07:00-05'::timestamptz, 'late evening waits until 07:00 the next morning');
select is(
  private.quiet_hours_release('2026-11-21 03:15-05', 'America/New_York', 1260, 420),
  '2026-11-21 07:00-05'::timestamptz, 'the small hours wait until 07:00 the same day');
select is(
  private.quiet_hours_release('2026-11-20 21:00-05', 'America/New_York', 1260, 420),
  '2026-11-21 07:00-05'::timestamptz, 'quiet hours start on the minute');
select is(
  private.quiet_hours_release('2026-11-21 07:00-05', 'America/New_York', 1260, 420),
  '2026-11-21 07:00-05'::timestamptz, 'and end on the minute');
-- The same instant is 19:30 in Los Angeles: not quiet there.
select is(
  private.quiet_hours_release('2026-11-20 22:30-05', 'America/Los_Angeles', 1260, 420),
  '2026-11-20 22:30-05'::timestamptz, 'quiet hours follow the household''s timezone');
-- A daytime nap window (13:00-15:00) that doesn't cross midnight.
select is(
  private.quiet_hours_release('2026-11-20 13:30-06', 'America/Chicago', 780, 900),
  '2026-11-20 15:00-06'::timestamptz, 'a window within the day holds until it ends');
select is(
  private.quiet_hours_release('2026-11-20 16:00-06', 'America/Chicago', 780, 900),
  '2026-11-20 16:00-06'::timestamptz, 'and lets pushes through after it');
select is(
  private.quiet_hours_release('2026-11-20 23:00-05', 'America/New_York', 600, 600),
  '2026-11-20 23:00-05'::timestamptz, 'equal start and end means no quiet hours');
-- The night clocks go back in New York (2026-11-01): 07:00 is EST.
select is(
  private.quiet_hours_release('2026-11-01 01:30-04', 'America/New_York', 1260, 420),
  '2026-11-01 07:00-05'::timestamptz, 'the release time is local, across a DST change');

-- ---------------------------------------------------------------------------
-- Account export (FR-PRIV-2) and deletion
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (public.export_account_data() -> 'tables' -> 'notification_prefs' -> 0 ->> 'quiet_start_minute')::int,
  1320, 'the account export includes the member''s notification settings');
reset role;
select private.erase_user('aaaaaaaa-0000-0000-0000-000000000001');
select is_empty(
  $$select user_id from public.notification_prefs
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'erasing the user removes their settings');

select * from finish();
rollback;
