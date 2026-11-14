-- R-02.1: recipes, their ingredient lines and steps, with RLS and household sync
-- (architecture sections 3.2 and 5; spec FR-REC-4, FR-REC-5, FR-REC-7, FR-REC-12, R-ING-1 to R-ING-5).
--
-- All three tables are synced (private.enable_sync, D-13): IDs are made on the device, the
-- server sets created_at, updated_at and version, and deletes are soft. Each line and step
-- is its own row, so two partners editing different lines never conflict.
--
-- The starter library is not in these tables: it ships with the app as versioned seed data
-- (R-04.1), and "save a copy" writes an ordinary household recipe that keeps the starter's
-- ID in library_recipe_id (FR-REC-3).

create table public.recipes (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- User content: never translated (architecture section 3.2).
  title text not null check (char_length(btrim(title)) between 1 and 120),
  servings smallint not null default 4 check (servings between 1 and 24),
  prep_minutes smallint check (prep_minutes between 0 and 1440),
  cook_minutes smallint check (cook_minutes between 0 and 1440),
  -- The fixed Phase 1 tag set (FR-REC-7), stored as IDs; names come from the locale files.
  tags text[] not null default '{}' check (
    tags <@ array[
      'tag.no_cook', 'tag.one_handed', 'tag.freezer_friendly', 'tag.batch_prep', 'tag.quick',
      'tag.kid_friendly', 'tag.toddler', 'tag.baby_led_weaning', 'tag.needs_defrosting'
    ]::text[]
  ),
  notes text check (char_length(notes) <= 5000),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'url', 'photo', 'screenshot', 'text', 'voice', 'library')),
  source_url text check (char_length(source_url) <= 2048),
  -- The starter recipe this is a copy of (FR-REC-3).
  library_recipe_id text check (library_recipe_id ~ '^starter\.[a-z0-9_]+$'),
  content_locale text not null check (content_locale in ('en-US', 'en-GB', 'en-AU')),
  -- Set by the server: who created the recipe and who last changed it.
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((source_type = 'library') = (library_recipe_id is not null))
);

create table public.recipe_ingredients (
  id uuid primary key,
  -- A copy of the recipe's household, so policies need no join (architecture section 4).
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  position smallint not null check (position between 0 and 999),
  -- A catalog ingredient or one of the household's own (R-ING-1).
  ingredient_id text not null references public.ingredients (id),
  quantity numeric check (quantity > 0 and quantity < 100000),
  unit_id text references public.units (id),
  -- quantity x unit.to_base, in g, ml or each (R-ING-3). Set by the server.
  quantity_base numeric,
  -- The line as typed or imported, for review and future re-parsing.
  raw_text text check (char_length(raw_text) <= 500),
  note text check (char_length(note) <= 200),
  optional boolean not null default false,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.recipe_steps (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  position smallint not null check (position between 0 and 999),
  text text not null check (char_length(btrim(text)) between 1 and 2000),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_ingredient_id_idx on public.recipe_ingredients (ingredient_id);
create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id);

-- ---------------------------------------------------------------------------
-- Authorship: the server records who created and last changed a recipe. Client values are
-- ignored, so they can't be forged.
-- ---------------------------------------------------------------------------
create function private.set_recipe_authors()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger set_recipe_authors before insert or update on public.recipes
  for each row execute function private.set_recipe_authors();

-- ---------------------------------------------------------------------------
-- Lines and steps belong to a recipe of their own household, for life. A line added
-- offline to a recipe that was deleted meanwhile arrives deleted too. Lines and steps are
-- capped per recipe (FR-REC-4: 100 lines and 50 steps, PROPOSED).
-- ---------------------------------------------------------------------------
create function private.check_recipe_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.recipes;
  live integer;
  cap constant integer := case tg_table_name when 'recipe_ingredients' then 100 else 50 end;
begin
  if tg_op = 'UPDATE' and new.recipe_id <> old.recipe_id then
    raise exception 'a recipe line cannot move to another recipe' using errcode = '23514';
  end if;
  select * into parent from public.recipes r where r.id = new.recipe_id;
  if parent.id is null or parent.household_id <> new.household_id then
    raise exception 'household_id does not match the recipe''s household' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if parent.deleted_at is not null then
      new.deleted_at := now();
    elsif new.deleted_at is null then
      execute format(
        'select count(*) from public.%I where recipe_id = $1 and deleted_at is null', tg_table_name)
        into live using new.recipe_id;
      if live >= cap then
        raise exception 'a recipe has at most % %', cap, tg_table_name using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger check_recipe_child before insert or update on public.recipe_ingredients
  for each row execute function private.check_recipe_child();
create trigger check_recipe_child before insert or update on public.recipe_steps
  for each row execute function private.check_recipe_child();

-- ---------------------------------------------------------------------------
-- Ingredient lines: the ingredient is the catalog's or the household's own, and the server
-- works out quantity_base (R-ING-3, R-ING-4, R-ING-5):
-- - quantity and a measured unit: quantity x unit.to_base.
-- - quantity, no unit, and an ingredient counted by default ("2 onions"): quantity each.
-- - anything else (no quantity, "a pinch", "salt to taste"): null.
-- ---------------------------------------------------------------------------
create function private.prepare_recipe_ingredient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dimension text;
  factor numeric;
begin
  select i.default_dimension into dimension
  from public.ingredients i
  where i.id = new.ingredient_id
    and (i.household_id is null or i.household_id = new.household_id);
  if dimension is null then
    raise exception 'the ingredient belongs to another household' using errcode = '23514';
  end if;

  if new.quantity is null then
    new.quantity_base := null;
  elsif new.unit_id is null then
    new.quantity_base := case when dimension = 'count' then new.quantity end;
  else
    select u.to_base into factor from public.units u where u.id = new.unit_id;
    new.quantity_base := new.quantity * factor;
  end if;
  return new;
end;
$$;

create trigger prepare_recipe_ingredient before insert or update on public.recipe_ingredients
  for each row execute function private.prepare_recipe_ingredient();

-- ---------------------------------------------------------------------------
-- Deleting a recipe deletes its lines and steps, as tombstones that sync.
-- ---------------------------------------------------------------------------
create function private.delete_recipe_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recipe_ingredients set deleted_at = now()
  where recipe_id = new.id and deleted_at is null;
  update public.recipe_steps set deleted_at = now()
  where recipe_id = new.id and deleted_at is null;
  return null;
end;
$$;

create trigger delete_recipe_children after update on public.recipes
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.delete_recipe_children();

revoke all on function private.set_recipe_authors() from public;
revoke all on function private.check_recipe_child() from public;
revoke all on function private.prepare_recipe_ingredient() from public;
revoke all on function private.delete_recipe_children() from public;

-- ---------------------------------------------------------------------------
-- RLS: members read their household's recipes; parents and family members write them;
-- caregivers only read (architecture section 3.3, spec section 2.2).
-- ---------------------------------------------------------------------------
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
revoke all on public.recipes, public.recipe_ingredients, public.recipe_steps from anon;

create policy "Members can read their household's recipes"
  on public.recipes for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family can add recipes"
  on public.recipes for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit recipes"
  on public.recipes for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

create policy "Members can read their household's recipe lines"
  on public.recipe_ingredients for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family can add recipe lines"
  on public.recipe_ingredients for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit recipe lines"
  on public.recipe_ingredients for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

create policy "Members can read their household's recipe steps"
  on public.recipe_steps for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family can add recipe steps"
  on public.recipe_steps for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit recipe steps"
  on public.recipe_steps for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

-- Server timestamps and versions, tombstones, no hard deletes, the pull index and Realtime.
select private.enable_sync('public.recipes');
select private.enable_sync('public.recipe_ingredients');
select private.enable_sync('public.recipe_steps');
