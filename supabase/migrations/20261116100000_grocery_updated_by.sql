-- G-04.1: who last changed each list item, for the "someone else is updating the list" banner
-- (spec FR-LIST-9; architecture sections 3.2 and 5).
--
-- `checked_by` only says who checked an item off. The banner needs to know when another
-- member added, edited, deleted or checked anything, so every write stamps the writer here.
-- The server sets it, never the client, like `checked_by` and `recorded_by`.

alter table public.grocery_items add column updated_by uuid;

create function private.set_grocery_updated_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Account erasure clears the column (set_null below); auth.uid() is null then anyway, but
  -- the bypass keeps the rule in one place (architecture section 3.4).
  if private.is_erasing() then
    return new;
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function private.set_grocery_updated_by() from public;

create trigger set_grocery_updated_by before insert or update on public.grocery_items
  for each row execute function private.set_grocery_updated_by();

-- Account deletion (A-04.3): the member's ID is cleared from items that stay with the household.
select private.register_for_deletion('public.grocery_items', 'updated_by', 'user', 'set_null');
