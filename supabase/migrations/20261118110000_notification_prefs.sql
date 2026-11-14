-- N-01.2 (FR-NOT-3, FR-NOT-6, FR-NOT-7): each member's notification settings, stored on the
-- server so the sender can check them (architecture "Notifications").
--
-- One row per user, written by the user. No row means the defaults: every type on, "plan
-- your week" the day before the household's week starts at 18:00, quiet hours 21:00 to 07:00.
-- Times are minutes after midnight in the household's timezone.

create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_week boolean not null default true,
  list_ready boolean not null default true,
  defrost boolean not null default true,
  household_changes boolean not null default true,
  -- ISO weekday (1 Monday to 7 Sunday) for "plan your week"; null is the day before the week starts.
  plan_week_day smallint check (plan_week_day between 1 and 7),
  plan_week_minute smallint not null default 1080 check (plan_week_minute between 0 and 1439),
  -- Quiet hours run from start to end, across midnight when end is earlier. Equal means none.
  quiet_start_minute smallint not null default 1260 check (quiet_start_minute between 0 and 1439),
  quiet_end_minute smallint not null default 420 check (quiet_end_minute between 0 and 1439),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.notification_prefs
  for each row execute function private.set_updated_at();

alter table public.notification_prefs enable row level security;

create policy "Users can read their own notification settings"
  on public.notification_prefs for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can create their own notification settings"
  on public.notification_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can change their own notification settings"
  on public.notification_prefs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke delete on public.notification_prefs from anon, authenticated;

-- A user's settings, with the defaults when they've never changed any.
create function private.notification_prefs_of(target uuid)
returns public.notification_prefs
language plpgsql
stable
set search_path = ''
as $$
declare
  prefs public.notification_prefs;
begin
  select * into prefs from public.notification_prefs where user_id = target;
  if not found then
    prefs := row(target, true, true, true, true, null, 1080, 1260, 420, now(), now());
  end if;
  return prefs;
end;
$$;

-- When a push due at `at` may go (FR-NOT-6): `at` itself outside quiet hours, otherwise the
-- end of quiet hours in the household's timezone.
create function private.quiet_hours_release(
  at timestamptz,
  tz text,
  start_minute integer,
  end_minute integer
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_at timestamp := at at time zone tz;
  minute integer := extract(hour from local_at)::integer * 60 + extract(minute from local_at)::integer;
  quiet boolean;
  release timestamp;
begin
  if start_minute = end_minute then
    return at;
  end if;
  quiet := case
    when start_minute < end_minute then minute >= start_minute and minute < end_minute
    else minute >= start_minute or minute < end_minute
  end;
  if not quiet then
    return at;
  end if;
  release := date_trunc('day', local_at) + make_interval(mins => end_minute);
  if release <= local_at then
    release := release + interval '1 day';
  end if;
  return release at time zone tz;
end;
$$;

revoke all on function private.notification_prefs_of(uuid) from public;
revoke all on function private.quiet_hours_release(timestamptz, text, integer, integer) from public;

-- Account deletion removes the settings (FR-PRIV-3).
select private.register_for_deletion('public.notification_prefs', 'user_id', 'user');
