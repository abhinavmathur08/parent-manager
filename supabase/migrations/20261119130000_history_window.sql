-- G-08: history of plans and lists (spec FR-LIST-13, FR-PAY-6, FR-PLAN-2, FR-PAY-9;
-- architecture section 8).
--
-- A free household sees the plans and lists of the current week and the 4 before it (D-9);
-- Premium sees everything. Enforced here, in the read policies of the synced plan and list
-- tables, through private.history_visible (M-03). Older rows are kept, never deleted: they
-- come back when Premium does, and the data export (a security definer function) always
-- includes them. The app pulls these tables in full again when the tier changes.
--
-- Writes need the row to be readable too, so an older week can't be edited on Free either.
-- purchase_events stay readable: purchase memory suggestions are free (FR-PAY-2).

-- Whether one plan entry, list or list item is inside the household's history window.
create function private.plan_entry_visible(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.history_visible(e.household_id, e.date)
     from public.plan_entries e where e.id = target),
    false)
$$;

create function private.grocery_list_visible(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.history_visible(l.household_id, l.week_start)
     from public.grocery_lists l where l.id = target),
    false)
$$;

create function private.grocery_item_visible(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.grocery_list_visible(i.list_id) from public.grocery_items i where i.id = target),
    false)
$$;

revoke all on function private.plan_entry_visible(uuid) from public;
revoke all on function private.grocery_list_visible(uuid) from public;
revoke all on function private.grocery_item_visible(uuid) from public;
grant execute on function private.plan_entry_visible(uuid) to authenticated;
grant execute on function private.grocery_list_visible(uuid) to authenticated;
grant execute on function private.grocery_item_visible(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
alter policy "Members can read their household's plan" on public.plan_entries
  using (
    private.household_role(household_id) is not null
    and private.history_visible(household_id, date)
  );

alter policy "Members can read their household's portions" on public.plan_entry_portions
  using (
    private.household_role(household_id) is not null
    and private.plan_entry_visible(entry_id)
  );

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------
alter policy "Members can read their household's lists" on public.grocery_lists
  using (
    private.household_role(household_id) is not null
    and private.history_visible(household_id, week_start)
  );

alter policy "Members can read their household's list items" on public.grocery_items
  using (
    private.household_role(household_id) is not null
    and private.grocery_list_visible(list_id)
  );

alter policy "Members can read their household's item sources" on public.grocery_item_sources
  using (
    private.household_role(household_id) is not null
    and private.grocery_item_visible(item_id)
  );

-- The app's S-34 history screen and the Plan tab ask where the window starts. Null means
-- everything is visible (Premium).
create function public.history_window()
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  select m.household_id into target
  from public.household_members m
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.deleted_at is null
  limit 1;
  if target is null or private.household_role(target) is null then
    raise exception 'not a household member' using errcode = '42501';
  end if;
  if private.household_is_premium(target) then
    return null;
  end if;
  return private.free_history_start(target);
end;
$$;

revoke all on function public.history_window() from public, anon;
grant execute on function public.history_window() to authenticated;
