-- N-01.3 (FR-NOT-1, FR-NOT-6, FR-NOT-7, FR-NOT-8, FR-NOT-9): the in-app inbox and the push
-- queue, in one table, and the job that hands due pushes to the `notify` Edge Function.
--
-- A notification is created for one member by private.enqueue_notification(), which checks
-- the member's switch for the type and, for push types, sets `deliver_at` to now or the end
-- of their quiet hours in the household's timezone. Inbox-only types have no `deliver_at`.
-- The Edge Function claims due rows, sends them through Expo push with copy in the member's
-- locale, and records `pushed_at`. Payloads hold IDs, dates and fixed values only: never
-- names, recipe or list text, children's details or allergies (FR-NOT-9, NFR-SEC-6).

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  type text not null check (type in ('plan_week', 'list_ready', 'household_changes', 'test')),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  -- Stops the same notification twice, such as one "plan your week" per member and week.
  dedupe_key text check (char_length(dedupe_key) <= 200),
  created_at timestamptz not null default now(),
  -- When the push may go; null for inbox-only notifications.
  deliver_at timestamptz,
  -- When the push was handed to Expo; null while it waits.
  pushed_at timestamptz,
  push_attempts smallint not null default 0,
  read_at timestamptz,
  unique (user_id, dedupe_key)
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_household_id_idx on public.notifications (household_id);
create index notifications_due_idx on public.notifications (deliver_at)
  where pushed_at is null and deliver_at is not null;

alter table public.notifications enable row level security;

create policy "Users can read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- Notifications are written by the server only; members mark them read with
-- mark_notifications_read().
revoke insert, update, delete on public.notifications from anon, authenticated;

-- The inbox keeps the last 50 (FR-NOT-8, PROPOSED). Older ones go once their push is done.
create function private.notification_inbox_size() returns integer
language sql immutable set search_path = '' as $$ select 50 $$;

-- ---------------------------------------------------------------------------
-- Creating notifications
-- ---------------------------------------------------------------------------

-- Creates a notification for one member, if their switch for the type is on (FR-NOT-7).
-- Push types wait for the end of quiet hours (FR-NOT-6). Returns the new row's ID, or null
-- when nothing was created (type off, or the same dedupe key already used).
create function private.enqueue_notification(
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

revoke all on function private.notification_inbox_size() from public;
revoke all on function private.enqueue_notification(uuid, uuid, text, jsonb, text) from public;

-- Household changes (FR-NOT-1): the other active members hear that someone joined or left,
-- in the inbox only. The payload says what happened, not who.
create function private.notify_household_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event text;
  member record;
begin
  if private.is_erasing() then
    return null;
  end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    event := 'member_joined';
  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status <> 'active' then
    event := 'member_left';
  else
    return null;
  end if;
  for member in
    select m.user_id from public.household_members m
    where m.household_id = new.household_id and m.status = 'active'
      and m.deleted_at is null and m.user_id <> new.user_id
  loop
    perform private.enqueue_notification(
      member.user_id, new.household_id, 'household_changes', jsonb_build_object('event', event));
  end loop;
  return null;
end;
$$;

revoke all on function private.notify_household_change() from public;

create trigger notify_household_change
  after insert or update of status on public.household_members
  for each row execute function private.notify_household_change();

-- A notification to the caller only, to check push works on a device (N-01.3 acceptance).
-- At most one a minute.
create function public.send_test_notification()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  hid uuid;
begin
  select m.household_id into hid from public.household_members m
  where m.user_id = uid and m.status = 'active' and m.deleted_at is null
  limit 1;
  if hid is null then
    raise exception 'not a member of a household' using errcode = '42501';
  end if;
  return private.enqueue_notification(
    uid, hid, 'test', '{}', 'test:' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI'));
end;
$$;

revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

-- ---------------------------------------------------------------------------
-- Reading (FR-NOT-8)
-- ---------------------------------------------------------------------------

-- Marks the caller's notifications read: the given ones, or all when `ids` is null. Reading
-- on one device marks them read everywhere.
create function public.mark_notifications_read(ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null and (ids is null or id = any (ids));
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending, for the `notify` Edge Function (service role only)
-- ---------------------------------------------------------------------------

-- Claims due pushes: marks them pushed and returns what the sender needs. Members who have
-- left the household or turned the type off since it was queued are skipped (marked pushed
-- without sending). A failed send hands its rows back with release_pushes().
create function public.claim_pushes(batch integer default 100)
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
    or (c.type = 'list_ready' and (private.notification_prefs_of(c.user_id)).list_ready);
end;
$$;

-- Hands claimed pushes back for another try, after a failed send.
create function public.release_pushes(ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set pushed_at = null where id = any (ids);
$$;

-- Drops tokens Expo reports as no longer registered (the app was removed).
create function public.drop_push_tokens(dead text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = any (dead);
$$;

revoke all on function public.claim_pushes(integer) from public, anon, authenticated;
revoke all on function public.release_pushes(uuid[]) from public, anon, authenticated;
revoke all on function public.drop_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.claim_pushes(integer) to service_role;
grant execute on function public.release_pushes(uuid[]) to service_role;
grant execute on function public.drop_push_tokens(text[]) to service_role;

-- Every minute, if pushes are due, calls the `notify` Edge Function through pg_net. The URL
-- and the shared secret live in Vault (`notify_function_url`, `notify_cron_secret`); until
-- they're added, nothing is sent.
create extension if not exists pg_net with schema extensions;

create function private.dispatch_pushes()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if not exists (
    select 1 from public.notifications n
    where n.pushed_at is null and n.deliver_at is not null and n.deliver_at <= now()
      and n.push_attempts < 5
  ) then
    return;
  end if;
  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'notify_function_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'notify_cron_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function private.dispatch_pushes() from public;

select cron.schedule('notify-pushes', '* * * * *', 'select private.dispatch_pushes()');

-- Account and household deletion remove notifications (FR-PRIV-3, FR-PRIV-7).
select private.register_for_deletion('public.notifications', 'household_id', 'household');
select private.register_for_deletion('public.notifications', 'user_id', 'user');
