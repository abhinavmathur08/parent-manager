-- R-02.3: deleting a recipe keeps its title on the plan (spec FR-REC-11, FR-PLAN edge case
-- "the planned recipe was deleted").
--
-- The app writes the snapshot itself when a member deletes a recipe: each live entry that
-- plans it becomes free text with the recipe's title, then the recipe is tombstoned. The
-- server makes the same true for writes the deleting device never saw:
-- - entries still pointing at the recipe when it's deleted (a partner's change that synced
--   first, or another device's copy of the plan), and
-- - entries added or changed offline to plan a recipe that was deleted meanwhile.
-- No table or column is added, so the deletion registry and export are unchanged.

-- ---------------------------------------------------------------------------
-- Deleting a recipe turns the live entries that plan it into free text with its title.
-- ---------------------------------------------------------------------------
create function private.snapshot_deleted_recipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.plan_entries
  set recipe_id = null, free_text = coalesce(free_text, new.title)
  where recipe_id = new.id and household_id = new.household_id and deleted_at is null;
  return null;
end;
$$;

create trigger snapshot_deleted_recipe after update on public.recipes
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.snapshot_deleted_recipe();

revoke all on function private.snapshot_deleted_recipe() from public;

-- ---------------------------------------------------------------------------
-- An entry's recipe and leftover link stay inside its own household (P-01.1). An entry that
-- arrives planning a deleted recipe keeps the title as free text instead.
-- ---------------------------------------------------------------------------
create or replace function private.check_plan_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  planned public.recipes;
begin
  if new.recipe_id is not null
    and (tg_op = 'INSERT' or new.recipe_id is distinct from old.recipe_id) then
    select * into planned from public.recipes r where r.id = new.recipe_id;
    if planned.id is null or planned.household_id <> new.household_id then
      raise exception 'the recipe belongs to another household' using errcode = '23514';
    end if;
    if planned.deleted_at is not null then
      new.free_text := coalesce(new.free_text, planned.title);
      new.recipe_id := null;
    end if;
  end if;
  if new.leftover_of_entry_id is not null
    and (tg_op = 'INSERT' or new.leftover_of_entry_id is distinct from old.leftover_of_entry_id)
    and not exists (
      select 1 from public.plan_entries e
      where e.id = new.leftover_of_entry_id and e.household_id = new.household_id
    ) then
    raise exception 'the linked entry belongs to another household' using errcode = '23514';
  end if;
  return new;
end;
$$;
