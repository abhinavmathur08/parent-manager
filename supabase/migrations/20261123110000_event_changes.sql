-- C-04.2 part 1 (FR2-REM-4, FR2-REM-6, D-15, D-16; architecture "Notifications"): `event_changed`.
--
-- When a member creates, moves or cancels an event (or one occurrence of a repeat) that happens
-- in the next 14 days, the other members who can see it get an inbox entry and a push, on
-- Premium only, at most one an hour per event and member. Server writes tell nobody.
--
-- Payloads carry the event ID, the change, the kind and a date only: never titles, places,
-- notes, people or names (FR2-REM-3, NFR-SEC-5). Push copy has no placeholders.
--
-- Repeats are expanded on the device (R2-CAL-1). The server needs only "which dates does this
-- series start on in a short range", so private.event_dates() repeats the device's rule
-- (src/features/calendar/repeat.ts) for that and nothing more.

-- ---------------------------------------------------------------------------
-- Settings and type
-- ---------------------------------------------------------------------------
alter table public.notification_prefs
  add column event_changes boolean not null default true;

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
    prefs := row(target, true, true, true, true, null, 1080, 1260, 420, now(), now(), true, true);
  end if;
  return prefs;
end;
$$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in ('plan_week', 'list_ready', 'household_changes', 'test', 'event_changed')
);

-- As in 20261118120000, with the `event_changed` switch.
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
-- Calendar helpers
-- ---------------------------------------------------------------------------

-- Whether a member can see an event now (D-16, mirrors private.can_read_event for someone
-- other than the caller): parents see every event; family members and caregivers see shared
-- ones while the household has Premium.
create function private.member_can_see_event(member uuid, target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    join public.households h on h.id = e.household_id and h.deleted_at is null
    join public.household_members m
      on m.household_id = e.household_id and m.user_id = member
      and m.status = 'active' and m.deleted_at is null
    where e.id = target
      and (m.role = 'parent' or (e.shared and private.household_is_premium(e.household_id)))
  )
$$;

-- The dates in [from_date, to_date] on which an event's occurrences start, in the household's
-- timezone, named by their original date (R2-CAL-2). Exceptions aren't applied. Follows the
-- device's rule: daily; weekly on ISO weekdays, every 1 or 2 weeks counted from the week of
-- the first date; monthly on the first date's day (months without it are skipped); ending on
-- `until` or after `count` occurrences.
create function private.event_dates(
  e public.events,
  tz text,
  week_start smallint,
  from_date date,
  to_date date
)
returns setof date
language plpgsql
stable
set search_path = ''
as $$
declare
  first date := case when e.all_day then e.start_date else (e.starts_at at time zone tz)::date end;
  freq text := e.repeat ->> 'freq';
  step integer := coalesce((e.repeat ->> 'interval')::integer, 1);
  last_date date := least(to_date, coalesce((e.repeat ->> 'until')::date, to_date));
  most integer := (e.repeat ->> 'count')::integer;
  days integer[] := array(
    select jsonb_array_elements_text(coalesce(e.repeat -> 'weekdays', '[]'::jsonb))::integer);
  first_week date;
begin
  if first is null or to_date < from_date then
    return;
  end if;
  if e.repeat is null then
    if first between from_date and to_date then
      return next first;
    end if;
    return;
  end if;
  first_week := first - ((extract(isodow from first)::integer - week_start + 7) % 7);
  return query
    select o.d from (
      select s.d::date as d, row_number() over (order by s.d) as n
      from generate_series(first::timestamp, last_date::timestamp, interval '1 day') s (d)
      where case freq
        when 'daily' then true
        when 'weekly' then extract(isodow from s.d)::integer = any (days)
          and ((s.d::date - first_week) / 7) % step = 0
        when 'monthly' then extract(day from s.d) = extract(day from first)
        else false
      end
    ) o
    where (most is null or o.n <= most) and o.d >= from_date;
end;
$$;

-- How far ahead a change is worth telling (FR2-REM-4, PROPOSED): today and the next 13 days.
create function private.event_change_days() returns integer
language sql immutable set search_path = '' as $$ select 14 $$;

-- ---------------------------------------------------------------------------
-- event_changed (FR2-REM-4)
-- ---------------------------------------------------------------------------

-- Queues `event_changed` for the other members who can see the event, if the household has
-- Premium (D-15) and the change touches the next 14 days. `occurrence` is the date it's about.
create function private.announce_event_change(
  target public.events,
  change text,
  occurrence date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  member record;
begin
  -- The server's own writes (no member) and Free households tell nobody.
  if actor is null or occurrence is null or not private.household_is_premium(target.household_id) then
    return;
  end if;
  for member in
    select m.user_id
    from public.household_members m
    where m.household_id = target.household_id and m.status = 'active' and m.deleted_at is null
      and m.user_id <> actor
      and (m.role = 'parent' or target.shared)
  loop
    perform private.enqueue_notification(
      member.user_id, target.household_id, 'event_changed',
      jsonb_build_object(
        'event_id', target.id, 'change', change, 'kind', target.kind, 'date', occurrence),
      'event_changed:' || target.id || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24'));
  end loop;
end;
$$;

-- The first date of `target` in the change window, in the household's timezone.
create function private.event_change_date(target public.events)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select min(d)
  from public.households h,
    lateral (select (now() at time zone h.timezone)::date as today) t,
    lateral private.event_dates(target, h.timezone, h.week_start, t.today,
      t.today + private.event_change_days() - 1) d
  where h.id = target.household_id
$$;

create function private.notify_event_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      perform private.announce_event_change(new, 'created', private.event_change_date(new));
    end if;
  elsif new.deleted_at is not null and old.deleted_at is null then
    perform private.announce_event_change(new, 'cancelled', private.event_change_date(old));
  elsif new.deleted_at is null
    and (new.all_day, new.starts_at, new.ends_at, new.start_date, new.end_date, new.repeat)
      is distinct from
        (old.all_day, old.starts_at, old.ends_at, old.start_date, old.end_date, old.repeat) then
    perform private.announce_event_change(new, 'moved',
      coalesce(private.event_change_date(new), private.event_change_date(old)));
  end if;
  return null;
end;
$$;

create trigger notify_event_change after insert or update on public.events
  for each row execute function private.notify_event_change();

-- One occurrence moved, skipped (cancelled) or put back: about that occurrence, when its
-- original or new date is in the window.
create function private.notify_event_exception_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.events;
  tz text;
  today date;
  moved_to date;
  change text;
begin
  if tg_op = 'UPDATE' and (new.status, new.starts_at, new.ends_at, new.start_date, new.end_date,
      new.deleted_at) is not distinct from
      (old.status, old.starts_at, old.ends_at, old.start_date, old.end_date, old.deleted_at) then
    return null;
  end if;
  if new.deleted_at is not null then
    return null;
  end if;
  select * into target from public.events e where e.id = new.event_id and e.deleted_at is null;
  if not found then
    return null;
  end if;
  select h.timezone into tz from public.households h where h.id = target.household_id;
  today := (now() at time zone tz)::date;
  moved_to := coalesce(new.start_date, (new.starts_at at time zone tz)::date);
  change := case new.status when 'skipped' then 'cancelled' else 'moved' end;
  perform private.announce_event_change(target, change,
    case
      when new.original_date between today and today + private.event_change_days() - 1
        then new.original_date
      when moved_to between today and today + private.event_change_days() - 1
        then new.original_date
    end);
  return null;
end;
$$;

create trigger notify_event_exception_change after insert or update on public.event_exceptions
  for each row execute function private.notify_event_exception_change();

-- ---------------------------------------------------------------------------
-- Sending: as in 20261118120000, plus `event_changed`, which is dropped if the household lapsed
-- or the member can no longer see the event (FR2-REM-6, D-16).
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
      and private.member_can_see_event(c.user_id, (c.payload ->> 'event_id')::uuid));
end;
$$;

revoke all on function private.member_can_see_event(uuid, uuid) from public;
revoke all on function private.event_dates(public.events, text, smallint, date, date) from public;
revoke all on function private.event_change_days() from public;
revoke all on function private.announce_event_change(public.events, text, date) from public;
revoke all on function private.event_change_date(public.events) from public;
revoke all on function private.notify_event_change() from public;
revoke all on function private.notify_event_exception_change() from public;
revoke all on function private.notification_prefs_of(uuid) from public;
revoke all on function private.enqueue_notification(uuid, uuid, text, jsonb, text) from public;
revoke all on function public.claim_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_pushes(integer) to service_role;
