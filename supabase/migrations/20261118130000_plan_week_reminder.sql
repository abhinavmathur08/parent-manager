-- N-02.1 (FR-NOT-3, FR-PLAN-12): the weekly "plan your week" reminder.
--
-- Every 5 minutes pg_cron queues the reminder for each member whose reminder time has come
-- in the household's timezone: by default the day before the week starts at 18:00, or the
-- day and time they chose (N-01.2). It isn't sent when the coming week is already planned
-- (5 or more dinners), and goes once per member and week. Quiet hours then hold it, and
-- the `notify` function sends it (N-01.3).

-- FR-PLAN-12 (PROPOSED): a week is planned with 5 or more days that have a live dinner.
create function private.week_is_planned(target_household uuid, week_start date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select count(distinct e.date) >= 5
  from public.plan_entries e
  where e.household_id = target_household
    and e.slot = 'dinner'
    and e.deleted_at is null
    and e.date >= week_start
    and e.date < week_start + 7;
$$;

-- At `at`, the start of the household's coming week (the next week start after today, local)
-- and when the reminder for it is due: `reminder_day` (an ISO weekday) before that start,
-- at `reminder_minute` local time. A reminder on the week-start day itself is a week ahead.
create function private.plan_week_due(
  at timestamptz,
  tz text,
  week_start_day smallint,
  reminder_day smallint,
  reminder_minute integer
)
returns table (week date, due timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  today date := (at at time zone tz)::date;
  ahead integer := (week_start_day - extract(isodow from today)::integer + 7) % 7;
  before integer := (week_start_day - reminder_day + 7) % 7;
begin
  if ahead = 0 then
    ahead := 7;
  end if;
  if before = 0 then
    before := 7;
  end if;
  week := today + ahead;
  due := ((week - before)::timestamp + make_interval(mins => reminder_minute)) at time zone tz;
  return next;
end;
$$;

-- A reminder whose time came longer ago than this is skipped (the job was down, or the
-- member moved the time to earlier the same day): better no reminder than a late one.
create function private.plan_week_window() returns interval
language sql immutable set search_path = '' as $$ select interval '6 hours' $$;

-- Queues the due reminders. Caregivers can't change the plan (spec section 2, action 20),
-- so they don't get one.
-- Returns how many were queued.
create function private.enqueue_plan_week_reminders(at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  member record;
  slot record;
  queued integer := 0;
begin
  for member in
    select m.user_id, m.household_id, h.timezone, h.week_start,
      p.plan_week_day, p.plan_week_minute
    from public.household_members m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    cross join lateral private.notification_prefs_of(m.user_id) p
    where m.status = 'active' and m.deleted_at is null and m.role <> 'caregiver'
      and p.plan_week
  loop
    select * into slot from private.plan_week_due(
      at, member.timezone, member.week_start,
      coalesce(member.plan_week_day,
        case when member.week_start = 1 then 7 else member.week_start - 1 end)::smallint,
      member.plan_week_minute);
    if slot.due <= at and at < slot.due + private.plan_week_window()
      and not private.week_is_planned(member.household_id, slot.week)
      and private.enqueue_notification(
        member.user_id, member.household_id, 'plan_week',
        jsonb_build_object('week_start', slot.week),
        'plan_week:' || slot.week) is not null
    then
      queued := queued + 1;
    end if;
  end loop;
  return queued;
end;
$$;

revoke all on function private.week_is_planned(uuid, date) from public;
revoke all on function private.plan_week_due(timestamptz, text, smallint, smallint, integer) from public;
revoke all on function private.plan_week_window() from public;
revoke all on function private.enqueue_plan_week_reminders(timestamptz) from public;

select cron.schedule(
  'plan-week-reminders',
  '*/5 * * * *',
  'select private.enqueue_plan_week_reminders()'
);
