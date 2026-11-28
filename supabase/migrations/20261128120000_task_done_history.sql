-- T-02.3: the free done history for tasks (spec FR3-TASK-9, FR3-PAY-2, R3-PAY-1; decisions D-9 and
-- D-24; architecture sections 3.6 and 8).
--
-- A free household sees done tasks completed in the current week and the `done_history_weeks`
-- before it (app_config `tasks.limits`, default 4), in the household's timezone and week start,
-- like plans and lists (G-08). Premium sees all. Open tasks are always visible. Older done tasks
-- are kept, never deleted: they come back with Premium, and the export (a security definer
-- function) includes them. Tasks are scoped (T-01.2), so devices drop the hidden ones and fetch
-- them again when they're visible.

-- The first instant a free household's done history shows.
create function private.task_history_start(target uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((today - ((extract(isodow from today)::int - h.week_start + 7) % 7)
      - 7 * coalesce(
        (select greatest((c.value ->> 'done_history_weeks')::integer, 0)
         from public.app_config c where c.key = 'tasks.limits'),
        4))::timestamp at time zone h.timezone)
  from public.households h
  cross join lateral (select (now() at time zone h.timezone)::date as today) d
  where h.id = target
$$;

-- Whether a task is inside the household's done history: open, Premium, or done recently.
create function private.task_done_visible(household uuid, done boolean, done_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not done or done_at is null or private.household_is_premium(household)
    or done_at >= private.task_history_start(household)
$$;

revoke all on function private.task_history_start(uuid) from public;
revoke all on function private.task_done_visible(uuid, boolean, timestamptz) from public;
grant execute on function private.task_history_start(uuid) to authenticated;
grant execute on function private.task_done_visible(uuid, boolean, timestamptz) to authenticated;

-- Reads and edits need the task inside the window, so an older done task can't be reopened on
-- Free either. A write that completes a task stays visible, so it reads back.
drop policy "Parents read every task; helpers read theirs, shared ones and rotations" on public.tasks;
drop policy "Members edit the tasks they can see" on public.tasks;

create policy "Members read the tasks they can see, within the done history"
  on public.tasks for select to authenticated
  using (
    private.task_visible(household_id, shared, assignee_user_id, rotation_user_ids)
    and private.task_done_visible(household_id, done, done_at)
  );
create policy "Members edit the tasks they can see, within the done history"
  on public.tasks for update to authenticated
  using (
    private.task_visible(household_id, shared, assignee_user_id, rotation_user_ids)
    and private.task_done_visible(household_id, done, done_at)
  )
  with check (private.task_visible(household_id, shared, assignee_user_id, rotation_user_ids));
