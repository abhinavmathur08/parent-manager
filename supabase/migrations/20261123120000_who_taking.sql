-- C-04.2 part 2 (FR2-REM-5; architecture "Notifications"): "who's taking?".
--
-- At 18:00 household time, the household's parents get a prompt for each appointment
-- tomorrow that nobody is taking, on Free too. The payload carries the event ID and the
-- occurrence's original date only.

-- ---------------------------------------------------------------------------
-- Setting and type
-- ---------------------------------------------------------------------------
alter table public.notification_prefs
  add column who_taking boolean not null default true;

create or replace function private.notification_prefs_of(target uuid)
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
    prefs := row(target, true, true, true, true, null, 1080, 1260, 420, now(), now(), true, true, true);
  end if;
  return prefs;
end;
$$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in ('plan_week', 'list_ready', 'household_changes', 'test', 'event_changed', 'who_taking')
);

-- As in 20261123110000, with the `who_taking` switch.
create or replace function private.enqueue_notification(
  recipient uuid,
  target_household uuid,
  kind text,
  details jsonb default '{}',
  dedupe text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefs public.notification_prefs := private.notification_prefs_of(recipient);
  tz text;
  enabled boolean;
  due timestamptz;
  created uuid;
begin
  enabled := case kind
    when 'plan_week' then prefs.plan_week
    when 'list_ready' then prefs.list_ready
    when 'household_changes' then prefs.household_changes
    when 'event_changed' then prefs.event_changes
    when 'who_taking' then prefs.who_taking
    when 'test' then true
  end;
  if not coalesce(enabled, false) then
    return null;
  end if;

  if kind <> 'household_changes' then
    select h.timezone into tz from public.households h where h.id = target_household;
    due := private.quiet_hours_release(now(), tz, prefs.quiet_start_minute, prefs.quiet_end_minute);
  end if;

  insert into public.notifications (user_id, household_id, type, payload, dedupe_key, deliver_at)
  values (recipient, target_household, kind, details, dedupe, due)
  on conflict (user_id, dedupe_key) do nothing
  returning id into created;

  if created is not null then
    delete from public.notifications n
    where n.user_id = recipient
      and (n.deliver_at is null or n.pushed_at is not null)
      and n.id in (
        select id from public.notifications
        where user_id = recipient
        order by created_at desc, id
        offset private.notification_inbox_size()
      );
  end if;
  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- who_taking (FR2-REM-5)
-- ---------------------------------------------------------------------------

-- When the prompt goes, in minutes after midnight household time (PROPOSED), and how late a
-- run may still send it (the job was down): better no prompt than one in the night.
create function private.who_taking_minute() returns integer
language sql immutable set search_path = '' as $$ select 18 * 60 $$;
create function private.who_taking_window() returns interval
language sql immutable set search_path = '' as $$ select interval '3 hours' $$;

-- The appointments starting on `day` in a household that nobody is taking: each occurrence's
-- event and original date. A skipped occurrence doesn't count; a moved one counts on the day
-- it moved to, with its own taking member if it has one (as on the device).
create function private.untaken_appointments(target uuid, day date)
returns table (event_id uuid, original_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, d
  from public.events e
  join public.households h on h.id = e.household_id,
    lateral private.event_dates(e, h.timezone, h.week_start, day, day) d
  where e.household_id = target and e.deleted_at is null and e.kind = 'kind.appointment'
    and e.taking_user_id is null
    and not exists (
      select 1 from public.event_exceptions x
      where e.repeat is not null and x.event_id = e.id and x.original_date = d
        and x.deleted_at is null and x.status in ('moved', 'skipped'))
  union
  select e.id, x.original_date
  from public.event_exceptions x
  join public.events e on e.id = x.event_id
  join public.households h on h.id = e.household_id
  where x.household_id = target and x.status = 'moved' and x.deleted_at is null
    and e.deleted_at is null and e.repeat is not null and e.kind = 'kind.appointment'
    and coalesce(x.taking_user_id, e.taking_user_id) is null
    and coalesce(x.start_date, (x.starts_at at time zone h.timezone)::date) = day
$$;

-- Whether nobody is taking one occurrence (named by its original date) of a live appointment,
-- checked again just before the prompt is sent.
create function private.occurrence_untaken(target uuid, original date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    left join public.event_exceptions x
      on e.repeat is not null and x.event_id = e.id and x.original_date = original
      and x.deleted_at is null and x.status in ('moved', 'skipped')
    where e.id = target and e.deleted_at is null and e.kind = 'kind.appointment'
      and coalesce(x.status, '') <> 'skipped'
      and (case when x.status = 'moved' then x.taking_user_id end) is null
      and e.taking_user_id is null
  )
$$;

-- Queues the prompts that are due. Runs every 5 minutes; each goes once per parent, event and
-- day. Returns how many were queued.
create function private.enqueue_who_taking(at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  household record;
  appointment record;
  parent record;
  queued integer := 0;
begin
  for household in
    select h.id, (at at time zone h.timezone)::date + 1 as tomorrow
    from public.households h
    where h.deleted_at is null
      and (at at time zone h.timezone)::time >= make_time(private.who_taking_minute() / 60,
        private.who_taking_minute() % 60, 0)
      and (at at time zone h.timezone)::time < make_time(private.who_taking_minute() / 60,
        private.who_taking_minute() % 60, 0) + private.who_taking_window()
  loop
    for appointment in select * from private.untaken_appointments(household.id, household.tomorrow)
    loop
      for parent in
        select m.user_id from public.household_members m
        where m.household_id = household.id and m.role = 'parent'
          and m.status = 'active' and m.deleted_at is null
      loop
        if private.enqueue_notification(
          parent.user_id, household.id, 'who_taking',
          jsonb_build_object('event_id', appointment.event_id, 'date', appointment.original_date),
          'who_taking:' || appointment.event_id || ':' || appointment.original_date) is not null
        then
          queued := queued + 1;
        end if;
      end loop;
    end loop;
  end loop;
  return queued;
end;
$$;

select cron.schedule('who-taking', '*/5 * * * *', 'select private.enqueue_who_taking()');

-- ---------------------------------------------------------------------------
-- Sending: as in 20261123110000, plus `who_taking`, which is dropped if the member is no longer
-- a parent or someone took the appointment since.
-- ---------------------------------------------------------------------------
create or replace function public.claim_pushes(batch integer default 100)
returns table (
  id uuid,
  user_id uuid,
  type text,
  payload jsonb,
  locale text,
  tokens text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select n.id from public.notifications n
    where n.pushed_at is null and n.deliver_at is not null and n.deliver_at <= now()
      and n.push_attempts < 5
    order by n.deliver_at
    limit batch
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set pushed_at = now(), push_attempts = n.push_attempts + 1
    from due
    where n.id = due.id
    returning n.id, n.user_id, n.household_id, n.type, n.payload
  )
  select c.id, c.user_id, c.type, c.payload,
    coalesce(p.locale, h.locale) as locale,
    array(select t.token from public.push_tokens t where t.user_id = c.user_id order by t.token) as tokens
  from claimed c
  join public.households h on h.id = c.household_id and h.deleted_at is null
  join public.household_members m
    on m.household_id = c.household_id and m.user_id = c.user_id
    and m.status = 'active' and m.deleted_at is null
  left join public.profiles p on p.id = c.user_id
  where c.type = 'test'
    or (c.type = 'plan_week' and (private.notification_prefs_of(c.user_id)).plan_week)
    or (c.type = 'list_ready' and (private.notification_prefs_of(c.user_id)).list_ready)
    or (c.type = 'event_changed' and (private.notification_prefs_of(c.user_id)).event_changes
      and private.household_is_premium(c.household_id)
      and private.member_can_see_event(c.user_id, (c.payload ->> 'event_id')::uuid))
    or (c.type = 'who_taking' and (private.notification_prefs_of(c.user_id)).who_taking
      and m.role = 'parent'
      and private.occurrence_untaken((c.payload ->> 'event_id')::uuid, (c.payload ->> 'date')::date));
end;
$$;

revoke all on function private.who_taking_minute() from public;
revoke all on function private.who_taking_window() from public;
revoke all on function private.untaken_appointments(uuid, date) from public;
revoke all on function private.occurrence_untaken(uuid, date) from public;
revoke all on function private.enqueue_who_taking(timestamptz) from public;
revoke all on function private.notification_prefs_of(uuid) from public;
revoke all on function private.enqueue_notification(uuid, uuid, text, jsonb, text) from public;
revoke all on function public.claim_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_pushes(integer) to service_role;
