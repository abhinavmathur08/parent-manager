-- N-02.1 (FR-NOT-3, FR-PLAN-12): "plan your week" is queued the day before the week starts at
-- 18:00 in each household's timezone, across US time zones; not when the coming week has 5
-- dinners; once per member and week; on the member's own day and time; never for caregivers
-- or members who turned it off.
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

create schema tests;

-- One parent per household, numbered NN: household 00000000-...-0000000000NN, user
-- aaaaaaaa-...-0000000000NN.
create function tests.hh(n integer) returns uuid language sql as $$
  select format('00000000-0000-0000-0000-%s', lpad(n::text, 12, '0'))::uuid $$;
create function tests.usr(n integer) returns uuid language sql as $$
  select format('aaaaaaaa-0000-0000-0000-%s', lpad(n::text, 12, '0'))::uuid $$;
create function tests.add_household(n integer, tz text, week_start integer) returns void
language plpgsql as $$
begin
  insert into auth.users (id, email, aud, role)
  values (tests.usr(n), format('p%s@example.test', n), 'authenticated', 'authenticated');
  insert into public.households (id, name, region, locale, unit_system, timezone, week_start)
  values (tests.hh(n), 'Household', 'US', 'en-US', 'us_customary', tz, week_start);
  insert into public.household_members (household_id, user_id, role)
  values (tests.hh(n), tests.usr(n), 'parent');
end;
$$;
create function tests.reminders(n integer) returns integer language sql as $$
  select count(*)::int from public.notifications
  where household_id = tests.hh(n) and type = 'plan_week' $$;
create function tests.dinners(n integer, dates date[]) returns void language sql as $$
  insert into public.plan_entries (id, household_id, date, slot, free_text, servings)
  select gen_random_uuid(), tests.hh(n), d, 'dinner', 'Dinner', 2 from unnest(dates) d $$;

-- Sunday-start households across US time zones. 21 November 2026 is a Saturday, on
-- standard time everywhere.
select tests.add_household(1, 'America/New_York', 7);
select tests.add_household(2, 'America/Chicago', 7);
select tests.add_household(3, 'America/Denver', 7);
select tests.add_household(4, 'America/Phoenix', 7);
select tests.add_household(5, 'America/Los_Angeles', 7);
select tests.add_household(6, 'America/Anchorage', 7);
select tests.add_household(7, 'Pacific/Honolulu', 7);

-- ---------------------------------------------------------------------------
-- The right local time (FR-NOT-3)
-- ---------------------------------------------------------------------------
select is(private.enqueue_plan_week_reminders('2026-11-21 17:59-05'), 0,
  'nothing before 18:00 in New York');
select is(private.enqueue_plan_week_reminders('2026-11-21 18:00-05'), 1,
  'at 18:00 in New York, one reminder');
select is(tests.reminders(1), 1, 'for the New York household');
select is(
  (select payload from public.notifications where household_id = tests.hh(1)),
  '{"week_start": "2026-11-22"}'::jsonb, 'for the week starting on Sunday, with no personal data');
select is(private.enqueue_plan_week_reminders('2026-11-21 18:30-05'), 0,
  'New York is not reminded twice');
select is(private.enqueue_plan_week_reminders('2026-11-21 18:00-06'), 1, 'Chicago at 18:00 local');
select is(tests.reminders(2), 1, 'for the Chicago household');
select is(private.enqueue_plan_week_reminders('2026-11-21 18:00-07'), 2,
  'Denver and Phoenix at 18:00 local, both on mountain standard time');
select ok(tests.reminders(3) = 1 and tests.reminders(4) = 1, 'for Denver and Phoenix');
select is(private.enqueue_plan_week_reminders('2026-11-21 17:59-08'), 0, 'not yet in Los Angeles');
select is(private.enqueue_plan_week_reminders('2026-11-21 18:00-08'), 1, 'Los Angeles at 18:00 local');
select is(private.enqueue_plan_week_reminders('2026-11-21 18:00-09'), 1, 'Anchorage at 18:00 local');
select is(private.enqueue_plan_week_reminders('2026-11-21 18:00-10'), 1, 'Honolulu at 18:00 local');
select is(
  (select count(*)::int from public.notifications where type = 'plan_week'), 7,
  'one reminder per household, all for the same week');

-- In summer New York is on daylight time; Phoenix never changes.
select is(private.enqueue_plan_week_reminders('2027-06-12 17:59-04'), 0,
  'in June, nothing before 18:00 EDT');
select is(private.enqueue_plan_week_reminders('2027-06-12 18:00-04'), 1,
  'and New York''s reminder at 18:00 EDT');
select is(
  (select payload ->> 'week_start' from public.notifications
   where household_id = tests.hh(1) and dedupe_key = 'plan_week:2027-06-13'),
  '2027-06-13', 'for the week starting the next day');
select private.enqueue_plan_week_reminders('2027-06-12 18:00-07');
select ok(
  (select count(*) = 2 from public.notifications
   where dedupe_key = 'plan_week:2027-06-13' and household_id in (tests.hh(4), tests.hh(5))),
  'at 18:00 MST it''s Phoenix''s turn, and the same instant is 18:00 PDT in Los Angeles');


-- ---------------------------------------------------------------------------
-- Already planned (FR-NOT-3, FR-PLAN-12)
-- ---------------------------------------------------------------------------
select tests.add_household(9, 'America/New_York', 7);
select tests.add_household(10, 'America/New_York', 7);
-- Household 9: five dinner days next week. Household 10: four dinner days, a second dinner
-- on one of them, a lunch and a removed dinner, which don't count.
select tests.dinners(9, array['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-28']::date[]);
select tests.dinners(10, array['2026-11-22', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']::date[]);
insert into public.plan_entries (id, household_id, date, slot, free_text, servings, deleted_at) values
  (gen_random_uuid(), tests.hh(10), '2026-11-26', 'dinner', 'Removed', 2, now());
insert into public.plan_entries (id, household_id, date, slot, free_text, servings) values
  (gen_random_uuid(), tests.hh(10), '2026-11-27', 'lunch', 'Lunch', 2);
-- This week's dinners don't count for next week.
select tests.dinners(10, array['2026-11-16', '2026-11-17', '2026-11-18']::date[]);

select ok(private.week_is_planned(tests.hh(9), '2026-11-22'), 'five dinner days is planned');
select ok(not private.week_is_planned(tests.hh(10), '2026-11-22'),
  'four dinner days is not, whatever else is in the week');
select is(private.enqueue_plan_week_reminders('2026-11-21 18:05-05'), 1,
  'at 18:05 in New York only the unplanned household is reminded');
select ok(tests.reminders(9) = 0 and tests.reminders(10) = 1,
  'the planned week is skipped, the unplanned one is not');

-- ---------------------------------------------------------------------------
-- Week start, the member's own day and time, roles and the switch
-- ---------------------------------------------------------------------------
-- Monday-start: the day before is Sunday.
select tests.add_household(11, 'America/New_York', 1);
select is(private.enqueue_plan_week_reminders('2026-11-22 18:00-05'), 1,
  'a Monday week is reminded on Sunday at 18:00');
select is(
  (select payload ->> 'week_start' from public.notifications where household_id = tests.hh(11)),
  '2026-11-23', 'for the week starting Monday');

-- Friday at 17:00, chosen in settings (N-01.2).
select tests.add_household(12, 'America/Chicago', 7);
insert into public.notification_prefs (user_id, plan_week_day, plan_week_minute)
values (tests.usr(12), 5, 1020);
select is(private.enqueue_plan_week_reminders('2026-11-20 17:00-06'), 1,
  'a member''s own day and time are used');
select is(tests.reminders(12), 1, 'for that member');

-- A caregiver in a Premium household, and a parent who turned the type off.
select tests.add_household(13, 'America/New_York', 7);
update public.household_entitlements set tier = 'premium' where household_id = tests.hh(13);
insert into auth.users (id, email, aud, role)
values (tests.usr(14), 'c@example.test', 'authenticated', 'authenticated');
insert into public.household_members (household_id, user_id, role)
values (tests.hh(13), tests.usr(14), 'caregiver');
insert into public.notification_prefs (user_id, plan_week) values (tests.usr(13), false);
select is(private.enqueue_plan_week_reminders('2026-11-28 18:00-05'), 3,
  'the next Saturday, the other Sunday-week households in New York are reminded again');
select is(tests.reminders(13), 0, 'but not a caregiver, or a parent who turned it off');

-- A reminder whose time passed long ago (the job was down) is skipped, not sent late.
select tests.add_household(8, 'America/New_York', 7);
-- 01:00 in New York is seven hours after its 18:00; the West is still within its window.
select ok(private.enqueue_plan_week_reminders('2026-12-06 01:00-05') > 0,
  'households still within the window are reminded');
select is(tests.reminders(8), 0, 'but seven hours late is too late for the New York household');

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------
select is(
  (select due from private.plan_week_due('2026-11-22 12:00-05', 'America/New_York', 7::smallint, 7::smallint, 1080)),
  '2026-11-22 18:00-05'::timestamptz,
  'a reminder on the week-start day itself is for the week after');
select is((select count(*)::int from cron.job where jobname = 'plan-week-reminders'), 1,
  'reminders are queued on a schedule');

select * from finish();
rollback;
