-- G-03.1: pantry_items with RLS, and the default staples for every new household
-- (architecture section 3.2; spec FR-PAN-1, FR-PAN-6, FR-PAN-7, FR-ONB-6, R-PAN-1, R-PAN-2).
--
-- Phase 1 tracks no quantities or expiry dates (FR-PAN-7), so this table has neither
-- quantity_base nor expires_on. They arrive with Phase 2 as a new migration.

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  ingredient_id text not null references public.ingredients (id) on delete cascade,
  -- staple: assumed at home and left off generated lists (FR-PAN-3, R-PAN-1).
  -- have: "I already have this" for one list week (FR-PAN-4, R-PAN-2).
  -- hidden_staple: a staple the household turned off. Kept, rather than deleted, so a
  --   later change to the default staples doesn't add it back (PROPOSED).
  status text not null check (status in ('staple', 'have', 'hidden_staple')),
  -- The list week a "have" applies to (R-PAN-2). Only "have" rows have one.
  have_week_start date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status = 'have') = (have_week_start is not null))
);

create index pantry_items_household_id_idx on public.pantry_items (household_id);
-- One live staple row per ingredient, and one live "have" per ingredient and week.
create unique index pantry_items_unique_staple on public.pantry_items (household_id, ingredient_id)
  where deleted_at is null and status in ('staple', 'hidden_staple');
create unique index pantry_items_unique_have
  on public.pantry_items (household_id, ingredient_id, have_week_start)
  where deleted_at is null and status = 'have';

create trigger set_updated_at before update on public.pantry_items
  for each row execute function private.set_updated_at();

-- A pantry row names a catalog ingredient or one of its own household's, and keeps its
-- household and ingredient for life (architecture section 4).
create function private.check_pantry_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (new.household_id <> old.household_id or new.ingredient_id <> old.ingredient_id) then
    raise exception 'a pantry item cannot change household or ingredient' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.ingredients i
    where i.id = new.ingredient_id
      and (i.household_id is null or i.household_id = new.household_id)
  ) then
    raise exception 'the ingredient belongs to another household' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_pantry_item before insert or update on public.pantry_items
  for each row execute function private.check_pantry_item();

alter table public.pantry_items enable row level security;
revoke all on public.pantry_items from anon;
-- Removing a staple or undoing a "have" is a soft delete (deleted_at), so it syncs (section 5).
revoke delete, truncate on public.pantry_items from authenticated;

-- Parents and family members manage staples. Caregivers can mark and undo "I already have
-- this", but can't change staples (FR-PAN-6, spec section 2.2).
create policy "Members can read their household's pantry"
  on public.pantry_items for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members can add to the pantry"
  on public.pantry_items for insert to authenticated
  with check (
    private.household_role(household_id) in ('parent', 'family')
    or (private.household_role(household_id) = 'caregiver' and status = 'have')
  );
create policy "Members can change the pantry"
  on public.pantry_items for update to authenticated
  using (
    private.household_role(household_id) in ('parent', 'family')
    or (private.household_role(household_id) = 'caregiver' and status = 'have')
  )
  with check (
    private.household_role(household_id) in ('parent', 'family')
    or (private.household_role(household_id) = 'caregiver' and status = 'have')
  );

-- ---------------------------------------------------------------------------
-- Default staples (FR-PAN-1, FR-ONB-6): every new household starts with the catalog's
-- default staples, with no setup screen. The list is the same in every region for now;
-- new.region is there for a regional list later.
-- ---------------------------------------------------------------------------
create function private.add_default_staples()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pantry_items (household_id, ingredient_id, status)
  select new.id, i.id, 'staple'
  from public.ingredients i
  where i.household_id is null and i.is_default_staple and i.deleted_at is null
  on conflict do nothing;
  return new;
end;
$$;

create trigger add_default_staples
  after insert on public.households
  for each row execute function private.add_default_staples();

-- Households created before this migration get them too.
insert into public.pantry_items (household_id, ingredient_id, status)
select h.id, i.id, 'staple'
from public.households h
cross join public.ingredients i
where i.household_id is null and i.is_default_staple and i.deleted_at is null
on conflict do nothing;
