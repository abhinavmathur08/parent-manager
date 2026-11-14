-- G-01.3: the weekly grocery list (architecture sections 3.2 and 5; spec FR-LIST-1, FR-LIST-2,
-- FR-LIST-5 to FR-LIST-8, FR-LIST-11, FR-LIST-12, FR-MEM-1, R-LIST-1 to R-LIST-8).
--
-- All four tables are synced (private.enable_sync, D-13): IDs are made on the device, the
-- server sets created_at, updated_at and version, and deletes are soft. The list engine runs
-- on the device (src/features/grocery) and writes ordinary rows (R-LIST-7); the IDs of the
-- rows it creates are worked out from their contents, so two devices write the same rows.
--
-- The pantry joins the sync layer here too, so the engine can leave out staples and "have"
-- items offline (R-LIST-3) and "I already have this" works offline (FR-PAN-4, FR-LIST-11).

-- ---------------------------------------------------------------------------
-- Lists: one default list per household and week (FR-LIST-1). Premium can have more later.
-- ---------------------------------------------------------------------------
create table public.grocery_lists (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- The first day of the list's week, in the household's week start (FR-LIST-1).
  week_start date not null,
  is_default boolean not null default true,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index grocery_lists_default_week_key on public.grocery_lists (household_id, week_start)
  where is_default and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Items. A plan item is made by the engine from the plan (origin 'plan'); a manual item is
-- added by a member (origin 'manual', FR-LIST-6). Quantities are in base units (g, ml or
-- each); the household's unit system is applied only for display (R-UNIT-5).
-- ---------------------------------------------------------------------------
create table public.grocery_items (
  id uuid primary key,
  -- A copy of the list's household, so policies need no join (architecture section 4).
  household_id uuid not null references public.households (id) on delete cascade,
  list_id uuid not null references public.grocery_lists (id) on delete cascade,
  -- A catalog or household ingredient, or null for a free-text item such as "birthday card".
  ingredient_id text references public.ingredients (id),
  -- A free-text item's name, or a member's rename of an ingredient item (FR-LIST-7).
  custom_name text check (char_length(btrim(custom_name)) between 1 and 120),
  dimension text check (dimension in ('mass', 'volume', 'count')),
  quantity_base numeric check (quantity_base > 0 and quantity_base < 10000000),
  -- A unit a member chose for the quantity; null shows the household's unit system.
  display_unit_id text references public.units (id),
  section_id text not null default 'section.other' references public.store_sections (id),
  origin text not null check (origin in ('plan', 'manual')),
  -- How much of the plan's need the item covers (R-LIST-4); 0 once recalculation deleted it.
  plan_quantity_base numeric check (plan_quantity_base >= 0),
  user_modified boolean not null default false,
  -- The plan changed after a member edited the item (R-LIST-4, PROPOSED hint).
  plan_changed boolean not null default false,
  -- Who checked the item off and when (FR-LIST-8); the sync rules keep a later check.
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by uuid,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ingredient_id is not null or custom_name is not null),
  check (origin = 'manual' or ingredient_id is not null),
  check (quantity_base is null or dimension is not null)
);

create index grocery_items_list_id_idx on public.grocery_items (list_id);
create index grocery_items_ingredient_id_idx on public.grocery_items (ingredient_id);

-- ---------------------------------------------------------------------------
-- Sources: the plan entry and recipe line behind a plan item (FR-LIST-12).
-- ---------------------------------------------------------------------------
create table public.grocery_item_sources (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  item_id uuid not null references public.grocery_items (id) on delete cascade,
  plan_entry_id uuid not null references public.plan_entries (id) on delete cascade,
  recipe_ingredient_id uuid not null references public.recipe_ingredients (id) on delete cascade,
  -- What this entry's line adds, in the item's base unit; null for no quantity.
  quantity_base numeric check (quantity_base >= 0),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index grocery_item_sources_item_id_idx on public.grocery_item_sources (item_id);
create index grocery_item_sources_plan_entry_id_idx on public.grocery_item_sources (plan_entry_id);
create index grocery_item_sources_recipe_ingredient_id_idx
  on public.grocery_item_sources (recipe_ingredient_id);

-- ---------------------------------------------------------------------------
-- Purchase events (FR-MEM-1, R-MEM-1): at most one per item, written on check-off or
-- "finish shopping" (G-04.2). Kept from the MVP so purchase memory has history.
-- ---------------------------------------------------------------------------
create table public.purchase_events (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  list_id uuid not null references public.grocery_lists (id) on delete cascade,
  item_id uuid not null references public.grocery_items (id) on delete cascade,
  -- The ingredient, or null for a free-text item, which the item ID stands for.
  ingredient_id text references public.ingredients (id),
  dimension text check (dimension in ('mass', 'volume', 'count')),
  quantity_base numeric check (quantity_base > 0),
  occurred_at timestamptz not null,
  source text not null check (source in ('checked_off', 'confirmed', 'receipt')),
  -- The member who bought it; cleared when they delete their account.
  recorded_by uuid,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index purchase_events_item_key on public.purchase_events (item_id)
  where deleted_at is null;
create index purchase_events_list_id_idx on public.purchase_events (list_id);
create index purchase_events_household_occurred_idx on public.purchase_events (household_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Rows stay inside their list's household, and keep their list, item and origin for life.
-- ---------------------------------------------------------------------------
create function private.check_grocery_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  list public.grocery_lists;
begin
  if private.is_erasing() then
    return new;
  end if;
  -- Refuse non-members before looking at other rows, so the errors below never tell them
  -- anything about another household (RLS checks the row only after this trigger).
  if auth.uid() is not null and private.household_role(new.household_id) is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.list_id <> old.list_id or new.origin <> old.origin
    or new.ingredient_id is distinct from old.ingredient_id) then
    raise exception 'an item cannot change list, origin or ingredient' using errcode = '23514';
  end if;
  select * into list from public.grocery_lists l where l.id = new.list_id;
  if list.id is null or list.household_id <> new.household_id then
    raise exception 'household_id does not match the list''s household' using errcode = '23514';
  end if;
  if new.ingredient_id is not null
    and (tg_op = 'INSERT' or new.ingredient_id is distinct from old.ingredient_id)
    and not exists (
      select 1 from public.ingredients i
      where i.id = new.ingredient_id
        and (i.household_id is null or i.household_id = new.household_id)
    ) then
    raise exception 'the ingredient belongs to another household' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_grocery_item before insert or update on public.grocery_items
  for each row execute function private.check_grocery_item();

-- A source names an item, plan entry and recipe line of its own household. A source added
-- offline to an item that was deleted meanwhile arrives deleted too.
create function private.check_grocery_item_source()
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
  if tg_op = 'UPDATE' and (new.item_id <> old.item_id or new.plan_entry_id <> old.plan_entry_id
    or new.recipe_ingredient_id <> old.recipe_ingredient_id) then
    raise exception 'a source cannot change item, entry or line' using errcode = '23514';
  end if;
  select * into item from public.grocery_items i where i.id = new.item_id;
  if item.id is null or item.household_id <> new.household_id then
    raise exception 'household_id does not match the item''s household' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.plan_entries e
    where e.id = new.plan_entry_id and e.household_id = new.household_id
  ) or not exists (
    select 1 from public.recipe_ingredients r
    where r.id = new.recipe_ingredient_id and r.household_id = new.household_id
  ) then
    raise exception 'the entry or line belongs to another household' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and item.deleted_at is not null then
    new.deleted_at := now();
  end if;
  return new;
end;
$$;

create trigger check_grocery_item_source before insert or update on public.grocery_item_sources
  for each row execute function private.check_grocery_item_source();

create function private.check_purchase_event()
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
  return new;
end;
$$;

create trigger check_purchase_event before insert or update on public.purchase_events
  for each row execute function private.check_purchase_event();

-- Deleting an item (by a member or recalculation) deletes its sources as tombstones that sync.
create function private.delete_grocery_item_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.grocery_item_sources set deleted_at = now()
  where item_id = new.id and deleted_at is null;
  return null;
end;
$$;

create trigger delete_grocery_item_sources after update on public.grocery_items
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.delete_grocery_item_sources();

revoke all on function private.check_grocery_item() from public;
revoke all on function private.check_grocery_item_source() from public;
revoke all on function private.check_purchase_event() from public;
revoke all on function private.delete_grocery_item_sources() from public;

-- ---------------------------------------------------------------------------
-- RLS (spec section 2.2, rows 26 to 29): every member reads the list, checks items off, adds
-- manual items, edits and deletes items, and records purchases. Lists are created by
-- parents and family members (FR-LIST-2), and by caregivers opening the List tab.
-- ---------------------------------------------------------------------------
alter table public.grocery_lists enable row level security;
alter table public.grocery_items enable row level security;
alter table public.grocery_item_sources enable row level security;
alter table public.purchase_events enable row level security;
revoke all on public.grocery_lists, public.grocery_items, public.grocery_item_sources,
  public.purchase_events from anon;

create policy "Members can read their household's lists"
  on public.grocery_lists for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members can create their household's lists"
  on public.grocery_lists for insert to authenticated
  with check (private.household_role(household_id) is not null);
create policy "Members can change their household's lists"
  on public.grocery_lists for update to authenticated
  using (private.household_role(household_id) is not null)
  with check (private.household_role(household_id) is not null);

create policy "Members can read their household's list items"
  on public.grocery_items for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members can add list items"
  on public.grocery_items for insert to authenticated
  with check (private.household_role(household_id) is not null);
create policy "Members can change list items"
  on public.grocery_items for update to authenticated
  using (private.household_role(household_id) is not null)
  with check (private.household_role(household_id) is not null);

create policy "Members can read their household's item sources"
  on public.grocery_item_sources for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members can add item sources"
  on public.grocery_item_sources for insert to authenticated
  with check (private.household_role(household_id) is not null);
create policy "Members can change item sources"
  on public.grocery_item_sources for update to authenticated
  using (private.household_role(household_id) is not null)
  with check (private.household_role(household_id) is not null);

create policy "Members can read their household's purchases"
  on public.purchase_events for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members can record purchases"
  on public.purchase_events for insert to authenticated
  with check (private.household_role(household_id) is not null);
create policy "Members can change purchases"
  on public.purchase_events for update to authenticated
  using (private.household_role(household_id) is not null)
  with check (private.household_role(household_id) is not null);

-- Server timestamps and versions, tombstones, no hard deletes, the pull index and Realtime.
-- A check-off records who and when, and a stale uncheck can't clear a newer check (FR-LIST-8).
select private.enable_sync('public.grocery_lists');
select private.enable_sync('public.grocery_items', array['checked']);
select private.enable_sync('public.grocery_item_sources');
select private.enable_sync('public.purchase_events');

-- ---------------------------------------------------------------------------
-- The pantry joins the sync layer (H-06): a version column, then the sync rules. Its own
-- updated_at trigger goes, since the sync rules set updated_at.
-- ---------------------------------------------------------------------------
alter table public.pantry_items add column version integer not null default 0;
drop trigger set_updated_at on public.pantry_items;
select private.enable_sync('public.pantry_items');

-- ---------------------------------------------------------------------------
-- Account and household deletion (A-04.3, FR-PRIV-3, FR-PRIV-7). Parents first, so the
-- children (registered later) are erased first.
-- ---------------------------------------------------------------------------
select private.register_for_deletion('public.grocery_lists', 'household_id', 'household');
select private.register_for_deletion('public.grocery_items', 'household_id', 'household');
select private.register_for_deletion('public.grocery_item_sources', 'household_id', 'household');
select private.register_for_deletion('public.purchase_events', 'household_id', 'household');
select private.register_for_deletion('public.grocery_items', 'checked_by', 'user', 'set_null');
select private.register_for_deletion('public.purchase_events', 'recorded_by', 'user', 'set_null');
