-- V-07 (FR2-DOC-7, FR2-DOC-8, FR2-DOC-11, D-15, D-19; architecture "Notifications"): document
-- expiry reminders.
--
-- Premium only: 30 days and 7 days before a ready document's expiry date (PROPOSED), each
-- parent gets an inbox entry and a push at 09:00 household time (PROPOSED). The payload is the
-- category and the date only. A `doc.medical` document's reminder has no category, so its
-- existence never reaches a notification (FR2-DOC-11, D-19). On a lapse they stop, and a
-- reminder queued before the lapse isn't pushed (FR2-DOC-8).

-- ---------------------------------------------------------------------------
-- Setting and type
-- ---------------------------------------------------------------------------
alter table public.notification_prefs
  add column document_expiry boolean not null default true;

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
    prefs := row(target, true, true, true, true, null, 1080, 1260, 420, now(), now(), true, true, true, true);
  end if;
  return prefs;
end;
$$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in ('plan_week', 'list_ready', 'household_changes', 'test', 'event_changed', 'who_taking',
    'document_expiring')
);

-- As in 20261123120000, with the `document_expiring` switch.
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
    when 'document_expiring' then prefs.document_expiry
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
-- The daily job
-- ---------------------------------------------------------------------------

-- How many days before the expiry date the reminders go (FR2-DOC-7, PROPOSED), when in the day
-- (minutes after midnight, household time) and how late a run may still send them.
create function private.document_expiry_days() returns integer[]
language sql immutable set search_path = '' as $$ select array[30, 7] $$;
create function private.document_expiry_minute() returns integer
language sql immutable set search_path = '' as $$ select 9 * 60 $$;
create function private.document_expiry_window() returns interval
language sql immutable set search_path = '' as $$ select interval '3 hours' $$;

-- Queues the reminders that are due. Runs every 5 minutes; each goes once per parent, document,
-- expiry date and lead time. Returns how many were queued.
create function private.enqueue_document_expiry(at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  queued integer := 0;
  start_time time := make_time(private.document_expiry_minute() / 60,
    private.document_expiry_minute() % 60, 0);
begin
  for due in
    select d.id, d.household_id, d.category, d.expires_on,
      d.expires_on - (at at time zone h.timezone)::date as days_left, m.user_id
    from public.households h
    join public.documents d
      on d.household_id = h.id and d.status = 'ready' and d.deleted_at is null
    join public.household_members m
      on m.household_id = h.id and m.role = 'parent' and m.status = 'active' and m.deleted_at is null
    where h.deleted_at is null
      and private.household_is_premium(h.id)
      and (at at time zone h.timezone)::time >= start_time
      and (at at time zone h.timezone)::time < start_time + private.document_expiry_window()
      and d.expires_on - (at at time zone h.timezone)::date = any (private.document_expiry_days())
  loop
    if private.enqueue_notification(
      due.user_id, due.household_id, 'document_expiring',
      jsonb_strip_nulls(jsonb_build_object(
        'category', case when due.category <> 'doc.medical' then due.category end,
        'expires_on', due.expires_on)),
      'document_expiring:' || due.id || ':' || due.expires_on || ':' || due.days_left) is not null
    then
      queued := queued + 1;
    end if;
  end loop;
  return queued;
end;
$$;

select cron.schedule('document-expiry', '*/5 * * * *', 'select private.enqueue_document_expiry()');

-- ---------------------------------------------------------------------------
-- Sending: as in 20261123120000, plus `document_expiring`, which goes only to a parent while the
-- household has Premium.
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
      and private.occurrence_untaken((c.payload ->> 'event_id')::uuid, (c.payload ->> 'date')::date))
    or (c.type = 'document_expiring' and (private.notification_prefs_of(c.user_id)).document_expiry
      and m.role = 'parent' and private.household_is_premium(c.household_id));
end;
$$;

revoke all on function private.document_expiry_days() from public;
revoke all on function private.document_expiry_minute() from public;
revoke all on function private.document_expiry_window() from public;
revoke all on function private.enqueue_document_expiry(timestamptz) from public;
revoke all on function private.notification_prefs_of(uuid) from public;
revoke all on function private.enqueue_notification(uuid, uuid, text, jsonb, text) from public;
revoke all on function public.claim_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_pushes(integer) to service_role;
