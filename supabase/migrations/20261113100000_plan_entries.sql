-- P-01.1: plan entries and portions per person, with RLS and household sync
-- (architecture sections 3.2 and 5; spec FR-PLAN-4, FR-PLAN-5, FR-PLAN-6, FR-PLAN-11, R-SERV-1, R-SERV-2).
--
-- Both tables are synced (private.enable_sync, D-13): IDs are made on the device, the server
-- sets created_at, updated_at and version, and deletes are soft, so a delete by one partner
-- wins over a move by the other. A week is a date range, so there is no week table.
--
-- An entry belongs to a calendar date in the household's timezone (spec 3.6, edge cases), so
-- `date` is a plain date, never a timestamp: a clock or timezone change never moves it.

create table public.plan_entries (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack', 'drink')),
  -- Order within the slot (FR-PLAN-4: a slot can hold a main and a side).
  position smallint not null default 0 check (position between 0 and 999),
  -- A household recipe, or free text such as "takeout" (FR-PLAN-3). A starter recipe is
  -- saved as a household copy first. Free text also keeps a deleted recipe's title (FR-REC-11).
  recipe_id uuid references public.recipes (id) on delete set null,
  free_text text check (char_length(btrim(free_text)) between 1 and 120),
  -- Servings in quarter steps: portions are 0, ½, 1 or 2, and a baby plate is ¼ (FR-PLAN-6).
  servings numeric(5, 2) not null check (servings > 0 and servings <= 99 and servings * 4 = trunc(servings * 4)),
  -- "Leftovers of" an earlier entry (FR-PLAN-8, P-04).
  leftover_of_entry_id uuid references public.plan_entries (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (recipe_id is not null or free_text is not null),
  check (leftover_of_entry_id is null or leftover_of_entry_id <> id)
);

create table public.plan_entry_portions (
  id uuid primary key,
  -- A copy of the entry's household, so policies need no join (architecture section 4).
  household_id uuid not null references public.households (id) on delete cascade,
  entry_id uuid not null references public.plan_entries (id) on delete cascade,
  person_id uuid not null references public.household_people (id) on delete cascade,
  portions numeric(3, 2) not null,
  variant text not null default 'standard' check (variant in ('standard', 'baby_plate')),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- FR-PLAN-6: 0 (not eating), ½, 1 or 2; a baby plate is always ¼.
  check (
    (variant = 'standard' and portions in (0, 0.5, 1, 2))
    or (variant = 'baby_plate' and portions = 0.25)
  )
);

-- One portion row per person per entry. The app derives the row's ID from the entry and the
-- person, so two partners setting the same person's portion offline write the same row.
create unique index plan_entry_portions_entry_person_key
  on public.plan_entry_portions (entry_id, person_id);
create index plan_entries_household_date_idx on public.plan_entries (household_id, date);
create index plan_entries_recipe_id_idx on public.plan_entries (recipe_id);
create index plan_entries_leftover_of_idx on public.plan_entries (leftover_of_entry_id);
create index plan_entry_portions_person_id_idx on public.plan_entry_portions (person_id);

-- ---------------------------------------------------------------------------
-- An entry's recipe and leftover link stay inside its own household.
-- ---------------------------------------------------------------------------
create function private.check_plan_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.recipe_id is not null
    and (tg_op = 'INSERT' or new.recipe_id is distinct from old.recipe_id)
    and not exists (
      select 1 from public.recipes r
      where r.id = new.recipe_id and r.household_id = new.household_id
    ) then
    raise exception 'the recipe belongs to another household' using errcode = '23514';
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

create trigger check_plan_entry before insert or update on public.plan_entries
  for each row execute function private.check_plan_entry();

-- ---------------------------------------------------------------------------
-- Portions belong to an entry and a person of their own household, for life. A portion set
-- offline on an entry that was deleted meanwhile arrives deleted too.
-- ---------------------------------------------------------------------------
create function private.check_plan_entry_portion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.plan_entries;
begin
  if tg_op = 'UPDATE' and (new.entry_id <> old.entry_id or new.person_id <> old.person_id) then
    raise exception 'a portion cannot move to another entry or person' using errcode = '23514';
  end if;
  select * into entry from public.plan_entries e where e.id = new.entry_id;
  if entry.id is null or entry.household_id <> new.household_id then
    raise exception 'household_id does not match the entry''s household' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.household_people p
    where p.id = new.person_id and p.household_id = new.household_id
  ) then
    raise exception 'the person belongs to another household' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and entry.deleted_at is not null then
    new.deleted_at := now();
  end if;
  return new;
end;
$$;

create trigger check_plan_entry_portion before insert or update on public.plan_entry_portions
  for each row execute function private.check_plan_entry_portion();

-- Removing an entry removes its portions, as tombstones that sync.
create function private.delete_plan_entry_portions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.plan_entry_portions set deleted_at = now()
  where entry_id = new.id and deleted_at is null;
  return null;
end;
$$;

create trigger delete_plan_entry_portions after update on public.plan_entries
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.delete_plan_entry_portions();

revoke all on function private.check_plan_entry() from public;
revoke all on function private.check_plan_entry_portion() from public;
revoke all on function private.delete_plan_entry_portions() from public;

-- ---------------------------------------------------------------------------
-- RLS: every member reads the plan; parents and family members write it; caregivers only
-- read (spec section 2.2, rows 19 to 21).
-- ---------------------------------------------------------------------------
alter table public.plan_entries enable row level security;
alter table public.plan_entry_portions enable row level security;
revoke all on public.plan_entries, public.plan_entry_portions from anon;

create policy "Members can read their household's plan"
  on public.plan_entries for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family can add plan entries"
  on public.plan_entries for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit plan entries"
  on public.plan_entries for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

create policy "Members can read their household's portions"
  on public.plan_entry_portions for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family can add portions"
  on public.plan_entry_portions for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit portions"
  on public.plan_entry_portions for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

-- Server timestamps and versions, tombstones, no hard deletes, the pull index and Realtime.
select private.enable_sync('public.plan_entries');
select private.enable_sync('public.plan_entry_portions');
