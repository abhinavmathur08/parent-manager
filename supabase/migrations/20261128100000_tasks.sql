-- T-01.1: tasks and chore occurrences, with RLS for parents, household sync and the free chore
-- cap (architecture section 3.6; spec FR3-TASK-3, FR3-TASK-6, FR3-PAY-2, R3-TASK-1 to R3-TASK-3,
-- R3-CHORE-1, R3-CHORE-2, R3-LINK-1, NFR3-SEC-1; decision D-24).
--
-- Both tables are synced (private.enable_sync, D-13): IDs are made on the device, the server sets
-- created_at, updated_at and version, and deletes are soft. `done` is a check column on both, so
-- the server records who completed a task or occurrence and when, and a stale reopen can't undo
-- a completion (R3-TASK-1, NFR3-OFF-2).
--
-- Who sees and writes what: parents, every task (spec section 2, T1 and T7). Family members and
-- caregivers get nothing here; T-01.2 adds their rules (R3-ACC-1, D-25) by replacing
-- private.can_read_task, private.can_edit_task and the tasks policies.
--
-- A chore is a task with a repeat: a calendar repeat rule (`repeat`, FR2-CAL-4) or "every N days
-- after it's done" (`after_done_days`). Its occurrences are expanded on the device and only the
-- ones done, skipped or reassigned are stored (R3-CHORE-1), one row per occurrence named by the
-- chore and its original date (R3-CHORE-2).

-- ---------------------------------------------------------------------------
-- Settings (R3-PAY-1, D-24), tuned without a release: the free chore cap (may be 0), the
-- Upcoming range and the free done history.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values (
  'tasks.limits',
  jsonb_build_object('free_chores', 3, 'upcoming_days', 14, 'done_history_weeks', 4)
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- Free text the member writes, or null for an unedited checklist item, whose text comes from
  -- the locale files by template_item_id (R3-TASK-2). Nothing matches or sorts on it.
  title text check (char_length(btrim(title)) between 1 and 200),
  template_item_id text check (template_item_id ~ '^checklist_item\.[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  notes text check (char_length(notes) <= 4000),
  -- No due, a date in the household's timezone, or an instant (FR3-TASK-3, R3-TASK-1).
  due_date date,
  due_at timestamptz,
  assignee_user_id uuid references auth.users (id) on delete set null,
  -- Visible to family members and caregivers (D-25). Only parents change it (T-01.2).
  shared boolean not null default false,
  -- One reminder (FR3-NOT-1): at the due time, 09:00 on the due day, or 18:00 the day before.
  reminder text check (reminder in ('reminder.at_time', 'reminder.morning', 'reminder.day_before')),
  -- A chore's rule (R3-CHORE-1): the calendar's repeat rule, or every N days after it's done.
  repeat jsonb check (private.valid_repeat(repeat)),
  after_done_days integer check (after_done_days between 1 and 90),
  -- Members taking turns, in order (D-26). Premium only.
  rotation_user_ids uuid[] check (
    rotation_user_ids is null
    or (cardinality(rotation_user_ids) between 2 and 12 and array_position(rotation_user_ids, null) is null)
  ),
  -- What the task was made from (R3-LINK-1): a link, not a foreign key, so deleting the source
  -- leaves the task.
  source_kind text check (
    source_kind in ('source.plan_entry', 'source.grocery_item', 'source.event', 'source.document',
                    'source.checklist')
  ),
  source_id uuid,
  -- The check column (architecture section 5): the server sets done_at and done_by.
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  -- Set by the server, never the client.
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (title is not null or template_item_id is not null),
  check (due_date is null or due_at is null),
  check (reminder is null or due_at is not null or (due_date is not null and reminder <> 'reminder.at_time')),
  check (repeat is null or after_done_days is null),
  -- A chore needs a first due date to repeat from; a rotation needs a chore.
  check ((repeat is null and after_done_days is null) or due_date is not null or due_at is not null),
  check (rotation_user_ids is null or repeat is not null or after_done_days is not null),
  check ((source_kind is null) = (source_id is null))
);

-- Done, skipped or reassigned occurrences of a chore (R3-CHORE-1). The device makes the ID with
-- stableId('task_occurrence', task_id, original_date), so two devices completing the same
-- occurrence offline write one row (R3-CHORE-2); the unique index holds even if one doesn't.
-- A client never deletes one: undoing sets done or skipped back. They're tombstoned only with
-- their chore.
create table public.task_occurrences (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  original_date date not null,
  assignee_user_id uuid references auth.users (id) on delete set null,
  skipped boolean not null default false,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index task_occurrences_task_date_key on public.task_occurrences (task_id, original_date);
create index tasks_household_due_date_idx on public.tasks (household_id, due_date);
create index tasks_household_due_at_idx on public.tasks (household_id, due_at);
create index tasks_assignee_user_id_idx on public.tasks (assignee_user_id);
create index tasks_done_by_idx on public.tasks (done_by);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_updated_by_idx on public.tasks (updated_by);
create index task_occurrences_assignee_user_id_idx on public.task_occurrences (assignee_user_id);
create index task_occurrences_done_by_idx on public.task_occurrences (done_by);

-- ---------------------------------------------------------------------------
-- Visibility helpers (architecture section 4). Parents only until T-01.2. Tombstones count, so
-- a deletion syncs.
-- ---------------------------------------------------------------------------
create function private.can_read_task(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target and private.household_role(t.household_id) = 'parent'
  )
$$;

-- Whether the caller may complete, skip or reassign a chore's occurrences.
create function private.can_edit_task(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target and private.household_role(t.household_id) = 'parent'
  )
$$;

revoke all on function private.can_read_task(uuid) from public;
revoke all on function private.can_edit_task(uuid) from public;
grant execute on function private.can_read_task(uuid) to authenticated;
grant execute on function private.can_edit_task(uuid) to authenticated;

-- Whether a user is an active member of the household (an assignee or a rotation member).
create function private.is_active_member(household uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = household and m.user_id = member
      and m.status = 'active' and m.deleted_at is null
  )
$$;

revoke all on function private.is_active_member(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Tasks: refuse non-members first, stamp the writer, and keep assignees and rotations inside the
-- household. Named to run before the cap and the sync triggers.
-- ---------------------------------------------------------------------------
create function private.check_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller constant uuid := (select auth.uid());
  member uuid;
begin
  -- Account erasure clears user columns (section 3.4); the row is left as erasure sets it.
  if private.is_erasing() then
    return new;
  end if;
  -- A tombstone never changes; the sync trigger answers a late edit with it.
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  -- Refuse non-members before reading anything else, so errors never leak another household.
  if private.household_role(new.household_id) is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := caller;
  else
    new.created_by := old.created_by;
  end if;
  new.updated_by := caller;

  if new.assignee_user_id is not null
    and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id)
    and not private.is_active_member(new.household_id, new.assignee_user_id) then
    raise exception 'the assignee is not in this household' using errcode = '23514';
  end if;

  if new.rotation_user_ids is not null
    and (tg_op = 'INSERT' or new.rotation_user_ids is distinct from old.rotation_user_ids) then
    if (select count(distinct m) from unnest(new.rotation_user_ids) m)
      <> cardinality(new.rotation_user_ids) then
      raise exception 'a member appears twice in the rotation' using errcode = '23514';
    end if;
    foreach member in array new.rotation_user_ids loop
      if not private.is_active_member(new.household_id, member) then
        raise exception 'a rotation member is not in this household' using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger check_task before insert or update on public.tasks
  for each row execute function private.check_task();

-- ---------------------------------------------------------------------------
-- The free chore cap and rotation (FR3-CHORE-7, FR3-PAY-2, D-24). Only a task becoming a chore
-- is counted, so a lapse keeps the chores already set (FR3-CHORE-6), and only a new or changed
-- rotation is refused, so a lapsed household can still clear one.
-- ---------------------------------------------------------------------------
create function private.free_chore_cap()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select greatest((c.value ->> 'free_chores')::integer, 0)
     from public.app_config c where c.key = 'tasks.limits'),
    3)
$$;

create function private.limit_task_chores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_chore constant boolean := new.repeat is not null or new.after_done_days is not null;
begin
  if private.is_erasing() or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  if private.household_is_premium(new.household_id) then
    return new;
  end if;

  if new.rotation_user_ids is not null
    and (tg_op = 'INSERT' or new.rotation_user_ids is distinct from old.rotation_user_ids) then
    -- A constraint error, so the device's queue refuses the write at once (architecture section
    -- 5) and the app shows the Premium sheet (trigger `chore_rotation`, FR3-PAY-1).
    raise exception 'rotation needs Premium' using errcode = '23514',
      hint = 'tasks.rotation_premium';
  end if;

  if is_chore and (tg_op = 'INSERT' or (old.repeat is null and old.after_done_days is null)) then
    -- One household at a time, so two concurrent writes can't both take the last place.
    perform pg_advisory_xact_lock(hashtextextended('task_chores:' || new.household_id::text, 0));
    if (select count(*) from public.tasks t
        where t.household_id = new.household_id and t.id <> new.id and t.deleted_at is null
          and (t.repeat is not null or t.after_done_days is not null))
      >= private.free_chore_cap() then
      -- The Premium sheet's trigger `recurring_chore` (FR3-PAY-1).
      raise exception 'the household has the most recurring chores allowed on Free'
        using errcode = '23514', hint = 'tasks.chore_limit';
    end if;
  end if;
  return new;
end;
$$;

create trigger limit_task_chores before insert or update on public.tasks
  for each row execute function private.limit_task_chores();

-- ---------------------------------------------------------------------------
-- Occurrences belong to a chore of their own household, for life, and keep their date. One
-- written offline to a chore deleted meanwhile arrives deleted.
-- ---------------------------------------------------------------------------
create function private.check_task_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  -- Refuse non-members, and tasks the caller can't see, the same way, so a wrong ID never tells
  -- them another household's task exists. A cascade from the chore's deletion skips this.
  if pg_trigger_depth() = 1 and (private.household_role(new.household_id) is null
    or not private.can_read_task(new.task_id)) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.task_id <> old.task_id or new.original_date <> old.original_date then
      raise exception 'an occurrence cannot move to another chore or date' using errcode = '23514';
    end if;
    if new.deleted_at is not null and pg_trigger_depth() = 1 then
      raise exception 'reopen or unskip the occurrence instead of deleting it'
        using errcode = '23514';
    end if;
  end if;
  select * into task from public.tasks t where t.id = new.task_id;
  if task.id is null or task.household_id <> new.household_id then
    raise exception 'household_id does not match the chore''s household' using errcode = '23514';
  end if;
  if task.repeat is null and task.after_done_days is null and task.deleted_at is null then
    raise exception 'the task does not repeat' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and task.deleted_at is not null then
    new.deleted_at := now();
  end if;
  if new.assignee_user_id is not null
    and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id)
    and not private.is_active_member(new.household_id, new.assignee_user_id) then
    raise exception 'the assignee is not in this household' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_task_occurrence before insert or update on public.task_occurrences
  for each row execute function private.check_task_occurrence();

-- Deleting a task tombstones its occurrences, which sync.
create function private.delete_task_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_occurrences set deleted_at = now()
  where task_id = new.id and deleted_at is null;
  return null;
end;
$$;

create trigger delete_task_children after update on public.tasks
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.delete_task_children();

revoke all on function private.check_task() from public;
revoke all on function private.free_chore_cap() from public;
revoke all on function private.limit_task_chores() from public;
revoke all on function private.check_task_occurrence() from public;
revoke all on function private.delete_task_children() from public;

-- ---------------------------------------------------------------------------
-- RLS: parents only until T-01.2.
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.task_occurrences enable row level security;
revoke all on public.tasks, public.task_occurrences from anon;

create policy "Parents read every task"
  on public.tasks for select to authenticated
  using (private.household_role(household_id) = 'parent');
create policy "Parents add tasks"
  on public.tasks for insert to authenticated
  with check (private.household_role(household_id) = 'parent');
create policy "Parents edit tasks"
  on public.tasks for update to authenticated
  using (private.household_role(household_id) = 'parent')
  with check (private.household_role(household_id) = 'parent');

create policy "Members read the occurrences of tasks they can see"
  on public.task_occurrences for select to authenticated
  using (private.can_read_task(task_id));
create policy "Task editors add occurrences"
  on public.task_occurrences for insert to authenticated
  with check (private.can_edit_task(task_id));
create policy "Task editors change occurrences"
  on public.task_occurrences for update to authenticated
  using (private.can_edit_task(task_id))
  with check (private.can_edit_task(task_id));

-- Server timestamps and versions, tombstones, the `done` check column, no hard deletes, the
-- pull index and Realtime.
select private.enable_sync('public.tasks', array['done']);
select private.enable_sync('public.task_occurrences', array['done']);

-- ---------------------------------------------------------------------------
-- Deletion (A-04.3) and export (A-04.2), FR3-PRIV-1 and FR3-PRIV-2. A-06 also clears a deleted
-- member from rotations and unassigns a leaving member's open tasks.
-- ---------------------------------------------------------------------------
select private.register_for_deletion('public.tasks', 'household_id', 'household');
select private.register_for_deletion('public.tasks', 'assignee_user_id', 'user', 'set_null');
select private.register_for_deletion('public.tasks', 'done_by', 'user', 'set_null');
select private.register_for_deletion('public.tasks', 'created_by', 'user', 'set_null');
select private.register_for_deletion('public.tasks', 'updated_by', 'user', 'set_null');
select private.register_for_deletion('public.task_occurrences', 'household_id', 'household');
select private.register_for_deletion('public.task_occurrences', 'assignee_user_id', 'user', 'set_null');
select private.register_for_deletion('public.task_occurrences', 'done_by', 'user', 'set_null');

select private.register_for_export('public.tasks', 'household', 'household_id');
select private.register_for_export('public.task_occurrences', 'household', 'household_id');
