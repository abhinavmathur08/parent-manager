-- T-01.2: what family members and caregivers see and do with tasks (architecture section 3.6;
-- spec section 2, R3-ACC-1, R3-ACC-3, NFR3-OFF-3, NFR3-SEC-1; decision D-25).
--
-- A helper (a family member or caregiver, while the household has Premium: household_role is
-- already null for them on Free) sees a task assigned to them, a shared task, or a chore whose
-- rotation they're in (R3-ACC-1). The occurrences follow their chore.
--
-- What a helper writes (spec section 2, T3 to T10):
--   - Adds tasks, always shared, assigned to nobody, themself or a parent; never a chore.
--   - Edits and deletes the tasks they created, without unsharing them.
--   - On any task they can see: completes or reopens it, takes it ("I'll do it"), or hands back
--     a shared one assigned to them, to nobody or a parent. Never assigns another helper.
--   - Completes any occurrence they can see; skips or reassigns only their own.
--
-- Parents keep every right, and on Premium only assign a task to a helper (FR3-PAY-1,
-- `helper_tasks`).
--
-- Both tables join scoped sync (C-01.3), since a task can stop being visible to a helper without
-- changing for them: unshared, reassigned, taken out of a rotation, a lapse or a removal
-- (R3-ACC-3, NFR3-OFF-3).

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------
create function private.task_visible(household uuid, shared boolean, assignee uuid, rotation uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select r is not null
    and (r = 'parent' or shared or assignee = (select auth.uid())
      or (select auth.uid()) = any (coalesce(rotation, '{}')))
  from (select private.household_role(household) as r) caller_role
$$;

revoke all on function private.task_visible(uuid, boolean, uuid, uuid[]) from public;
grant execute on function private.task_visible(uuid, boolean, uuid, uuid[]) to authenticated;

create or replace function private.can_read_task(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target
      and private.task_visible(t.household_id, t.shared, t.assignee_user_id, t.rotation_user_ids)
  )
$$;

-- Anyone who sees a chore may complete its occurrences; skipping and reassigning are checked in
-- private.check_task_occurrence.
create or replace function private.can_edit_task(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_read_task(target)
$$;

-- Whether a user is an active parent of the household (an assignee a helper may choose).
create function private.is_active_parent(household uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = household and m.user_id = member and m.role = 'parent'
      and m.status = 'active' and m.deleted_at is null
  )
$$;

revoke all on function private.is_active_parent(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Tasks: the role rules RLS can't express
-- ---------------------------------------------------------------------------
create or replace function private.check_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller constant uuid := (select auth.uid());
  role text;
  member uuid;
  -- What a helper may change on a task someone else created (T6), plus what the server sets.
  free_columns constant text[] := array['done', 'done_at', 'done_by', 'assignee_user_id',
    'updated_by', 'version', 'created_at', 'updated_at'];
  assignee_changed boolean;
begin
  -- Account erasure clears user columns (section 3.4); the row is left as erasure sets it.
  if private.is_erasing() then
    return new;
  end if;
  -- A tombstone never changes; the sync trigger answers a late edit with it.
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  role := private.household_role(new.household_id);
  -- Refuse non-members before reading anything else, so errors never leak another household.
  if role is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;

  assignee_changed := tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id;

  if tg_op = 'INSERT' then
    new.created_by := caller;
  else
    new.created_by := old.created_by;
  end if;

  if role <> 'parent' then
    if tg_op = 'INSERT' then
      if not new.shared then
        raise exception 'a helper''s task is always shared' using errcode = '42501';
      end if;
    elsif new.shared is distinct from old.shared then
      raise exception 'only a parent can share or unshare a task' using errcode = '42501';
    end if;
    if (new.repeat is not null or new.after_done_days is not null or new.rotation_user_ids is not null)
      and (tg_op = 'INSERT' or new.repeat is distinct from old.repeat
        or new.after_done_days is distinct from old.after_done_days
        or new.rotation_user_ids is distinct from old.rotation_user_ids) then
      raise exception 'only a parent can set a repeat or a rotation' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.created_by is distinct from caller then
      if (to_jsonb(new) - free_columns) is distinct from (to_jsonb(old) - free_columns) then
        raise exception 'only the task''s creator or a parent can change it' using errcode = '42501';
      end if;
      -- Take it, or hand back one assigned to them.
      if assignee_changed and new.assignee_user_id is distinct from caller
        and old.assignee_user_id is distinct from caller then
        raise exception 'a helper can only take a task or hand back their own' using errcode = '42501';
      end if;
    end if;
    -- Handing back a private task would hide it from the helper mid-write; the device's write
    -- reads the row back, which RLS would refuse. Only shared tasks are handed back.
    if tg_op = 'UPDATE' and assignee_changed and old.assignee_user_id = caller and not new.shared then
      raise exception 'a helper hands back only a shared task' using errcode = '42501';
    end if;
    if assignee_changed and new.assignee_user_id is not null and new.assignee_user_id <> caller
      and not private.is_active_parent(new.household_id, new.assignee_user_id) then
      raise exception 'a helper assigns only to themself or a parent' using errcode = '42501';
    end if;
  elsif assignee_changed and new.assignee_user_id is not null
    and not private.household_is_premium(new.household_id)
    and not private.is_active_parent(new.household_id, new.assignee_user_id)
    and private.is_active_member(new.household_id, new.assignee_user_id) then
    -- The Premium sheet's trigger `helper_tasks` (FR3-PAY-1).
    raise exception 'assigning to a helper needs Premium' using errcode = '23514',
      hint = 'tasks.helper_premium';
  end if;
  new.updated_by := caller;

  if new.assignee_user_id is not null and assignee_changed
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

-- ---------------------------------------------------------------------------
-- Occurrences: a helper skips or reassigns only their own (T10).
-- ---------------------------------------------------------------------------
create function private.check_task_occurrence_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller constant uuid := (select auth.uid());
  task public.tasks;
begin
  if private.is_erasing() or pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  if private.household_role(new.household_id) = 'parent' then
    return new;
  end if;
  select * into task from public.tasks t where t.id = new.task_id;

  if tg_op = 'INSERT' then
    -- The first write of an occurrence records its assignee: the chore's, the rotation's turn
    -- (R3-CHORE-3) or the helper themself.
    if new.assignee_user_id is not null and new.assignee_user_id <> caller
      and new.assignee_user_id is distinct from task.assignee_user_id
      and not new.assignee_user_id = any (coalesce(task.rotation_user_ids, '{}')) then
      raise exception 'a helper assigns only to themself or a parent' using errcode = '42501';
    end if;
    if new.skipped and new.assignee_user_id is distinct from caller then
      raise exception 'a helper skips or reassigns only their own occurrence' using errcode = '42501';
    end if;
  else
    if (new.skipped is distinct from old.skipped
        or new.assignee_user_id is distinct from old.assignee_user_id)
      and old.assignee_user_id is distinct from caller then
      raise exception 'a helper skips or reassigns only their own occurrence' using errcode = '42501';
    end if;
    if new.assignee_user_id is distinct from old.assignee_user_id
      and new.assignee_user_id is not null and new.assignee_user_id <> caller
      and not private.is_active_parent(new.household_id, new.assignee_user_id) then
      raise exception 'a helper assigns only to themself or a parent' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.check_task_occurrence_role() from public;

-- After check_task_occurrence (membership and the chore first), before the sync triggers.
create trigger check_task_occurrence_role before insert or update on public.task_occurrences
  for each row execute function private.check_task_occurrence_role();

-- ---------------------------------------------------------------------------
-- RLS: R3-ACC-1. The trigger above holds the finer rules.
-- ---------------------------------------------------------------------------
drop policy "Parents read every task" on public.tasks;
drop policy "Parents add tasks" on public.tasks;
drop policy "Parents edit tasks" on public.tasks;

create policy "Parents read every task; helpers read theirs, shared ones and rotations"
  on public.tasks for select to authenticated
  using (private.task_visible(household_id, shared, assignee_user_id, rotation_user_ids));
create policy "Parents add any task; helpers add shared tasks"
  on public.tasks for insert to authenticated
  with check (
    private.household_role(household_id) = 'parent'
    or (shared and private.household_role(household_id) is not null)
  );
create policy "Members edit the tasks they can see"
  on public.tasks for update to authenticated
  using (private.task_visible(household_id, shared, assignee_user_id, rotation_user_ids))
  with check (private.task_visible(household_id, shared, assignee_user_id, rotation_user_ids));

-- Scoped sync (C-01.3): devices drop tasks and occurrences they can no longer see.
select private.enable_scoped_sync('public.tasks');
select private.enable_scoped_sync('public.task_occurrences');
