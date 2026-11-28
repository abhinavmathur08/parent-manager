-- T-04.2 (FR3-NOT-3, FR3-NOT-5; architecture "Notifications"): "assigned to you".
--
-- When another member assigns a task, or one occurrence of a chore, to someone, the assignee
-- gets an inbox entry and a push. Pushes are batched to at most 1 an hour per assignee
-- (PROPOSED): while one is waiting to go, later assignments join it, and one that comes within
-- the hour after a push waits until the hour is up. The copy is fixed text and the payload is
-- the task IDs only. Assigning yourself ("I'll do it"), the server's own writes and rotation
-- turns send nothing. Free.

-- ---------------------------------------------------------------------------
-- Setting and type
-- ---------------------------------------------------------------------------
alter table public.notification_prefs
  add column task_assigned boolean not null default true;

-- As in 20261129200000, with `task_assigned` in the default row (it's built positionally).
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
    prefs := row(target, true, true, true, true, null, 1080, 1260, 420, now(), now(), true, true, true,
      true, true, true, true);
  end if;
  return prefs;
end;
$$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in ('plan_week', 'list_ready', 'household_changes', 'test', 'event_changed', 'who_taking',
    'document_expiring', 'task_assigned')
);

-- As in 20261123130000, with the `task_assigned` switch.
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
    when 'task_assigned' then prefs.task_assigned
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
-- Queueing
-- ---------------------------------------------------------------------------

-- How often an assignee may be pushed (FR3-NOT-3, PROPOSED), and how many task IDs one batch
-- keeps.
create function private.task_assigned_interval() returns interval
language sql immutable set search_path = '' as $$ select interval '1 hour' $$;
create function private.task_assigned_batch() returns integer
language sql immutable set search_path = '' as $$ select 20 $$;

-- Tells `recipient` that `task` (or one of its occurrences) is now theirs: joins the entry
-- still waiting to be pushed, or queues a new one no sooner than an hour after the last push.
create function private.announce_task_assigned(recipient uuid, target_household uuid, task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  waiting public.notifications;
  last_push timestamptz;
  created uuid;
begin
  select * into waiting from public.notifications n
  where n.user_id = recipient and n.type = 'task_assigned' and n.pushed_at is null
    and n.deliver_at is not null
  order by n.created_at desc
  limit 1
  for update;

  if found then
    if not ((waiting.payload -> 'task_ids') ? task::text)
      and jsonb_array_length(waiting.payload -> 'task_ids') < private.task_assigned_batch() then
      update public.notifications
      set payload = jsonb_build_object('task_ids', (waiting.payload -> 'task_ids') || to_jsonb(task::text)),
        read_at = null
      where id = waiting.id;
    end if;
    return;
  end if;

  created := private.enqueue_notification(recipient, target_household, 'task_assigned',
    jsonb_build_object('task_ids', jsonb_build_array(task)));
  if created is null then
    return;
  end if;

  select max(n.pushed_at) into last_push from public.notifications n
  where n.user_id = recipient and n.type = 'task_assigned' and n.pushed_at is not null;
  if last_push > now() - private.task_assigned_interval() then
    update public.notifications
    set deliver_at = greatest(deliver_at, last_push + private.task_assigned_interval())
    where id = created;
  end if;
end;
$$;

-- Whether `assignee` is simply the next turn of `rotation` after `previous` (D-26): rotation
-- turns don't notify (FR3-NOT-3).
create function private.is_rotation_turn(rotation uuid[], previous uuid, assignee uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select rotation is not null and previous is not null
    and array_position(rotation, previous) is not null
    and rotation[array_position(rotation, previous) % cardinality(rotation) + 1] = assignee
$$;

create function private.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  previous uuid;
  task_id uuid;
  rotation uuid[];
begin
  if tg_op = 'UPDATE' then
    previous := old.assignee_user_id;
  end if;
  -- Only a new assignee chosen by another member, on something still open.
  if actor is null or new.assignee_user_id is null or new.assignee_user_id = actor
    or new.assignee_user_id is not distinct from previous
    or new.deleted_at is not null or new.done then
    return null;
  end if;

  if tg_table_name = 'tasks' then
    task_id := new.id;
    rotation := new.rotation_user_ids;
  else
    -- A skipped occurrence isn't anyone's to do.
    if new.skipped then
      return null;
    end if;
    task_id := new.task_id;
    select t.rotation_user_ids into rotation from public.tasks t where t.id = new.task_id;
  end if;

  if not private.is_rotation_turn(rotation, previous, new.assignee_user_id) then
    perform private.announce_task_assigned(new.assignee_user_id, new.household_id, task_id);
  end if;
  return null;
end;
$$;

create trigger notify_task_assigned after insert or update of assignee_user_id on public.tasks
  for each row execute function private.notify_task_assigned();
create trigger notify_task_assigned after insert or update of assignee_user_id
  on public.task_occurrences
  for each row execute function private.notify_task_assigned();

-- ---------------------------------------------------------------------------
-- Sending: as in 20261123130000, plus `task_assigned` while its switch is on.
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
      and m.role = 'parent' and private.household_is_premium(c.household_id))
    or (c.type = 'task_assigned' and (private.notification_prefs_of(c.user_id)).task_assigned);
end;
$$;

revoke all on function private.task_assigned_interval() from public;
revoke all on function private.task_assigned_batch() from public;
revoke all on function private.announce_task_assigned(uuid, uuid, uuid) from public;
revoke all on function private.is_rotation_turn(uuid[], uuid, uuid) from public;
revoke all on function private.notify_task_assigned() from public;
revoke all on function private.notification_prefs_of(uuid) from public;
revoke all on function private.enqueue_notification(uuid, uuid, text, jsonb, text) from public;
revoke all on function public.claim_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_pushes(integer) to service_role;
