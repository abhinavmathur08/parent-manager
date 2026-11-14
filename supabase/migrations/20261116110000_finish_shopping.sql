-- G-04.2: "finish shopping" and purchase events (spec FR-LIST-8, FR-LIST-10, FR-MEM-1,
-- FR-MEM-2, R-MEM-1; architecture sections 3.2 and 5).
--
-- 1. grocery_items.shopped_at: "finish shopping" moves checked items into the week's history.
--    The item stays a live, checked row, so the list engine still counts what was bought
--    (R-LIST-4), and the List tab leaves it out. The server sets the time, and once set it
--    never changes.
-- 2. At most one live purchase event per item (R-MEM-1), without refusing a device: a second
--    event for an item that already has one, such as both partners checking it off offline,
--    arrives as a tombstone instead of failing the unique index.

alter table public.grocery_items add column shopped_at timestamptz;

create function private.set_grocery_shopped_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.shopped_at is not null then
    new.shopped_at := old.shopped_at;
  elsif new.shopped_at is not null then
    new.shopped_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function private.set_grocery_shopped_at() from public;

create trigger set_grocery_shopped_at before insert or update on public.grocery_items
  for each row execute function private.set_grocery_shopped_at();

-- The same checks as 20261114100000_grocery.sql, plus the duplicate rule at the end.
create or replace function private.check_purchase_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.grocery_items;
begin
  if private.is_erasing() then
    return new;
  end if;
  -- Refuse non-members before looking at other rows, so the errors below never tell them
  -- anything about another household (RLS checks the row only after this trigger).
  if auth.uid() is not null and private.household_role(new.household_id) is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.item_id <> old.item_id or new.list_id <> old.list_id) then
    raise exception 'a purchase event cannot change item or list' using errcode = '23514';
  end if;
  select * into item from public.grocery_items i where i.id = new.item_id;
  if item.id is null or item.household_id <> new.household_id or item.list_id <> new.list_id then
    raise exception 'the event does not match its item''s household and list' using errcode = '23514';
  end if;
  if new.ingredient_id is distinct from item.ingredient_id then
    raise exception 'the event''s ingredient is not its item''s' using errcode = '23514';
  end if;
  -- The member is whoever writes the event, never someone else (FR-MEM-1).
  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
  else
    new.recorded_by := old.recorded_by;
  end if;
  -- One live event per item (R-MEM-1): a second one is kept as a tombstone, so the device
  -- that sent it syncs on instead of stalling on the unique index.
  if tg_op = 'INSERT' and new.deleted_at is null and exists (
    select 1 from public.purchase_events e
    where e.item_id = new.item_id and e.deleted_at is null and e.id <> new.id
  ) then
    new.deleted_at := now();
  end if;
  return new;
end;
$$;
