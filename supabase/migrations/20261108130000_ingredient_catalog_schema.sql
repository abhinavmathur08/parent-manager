-- R-01.1: units, store_sections, ingredients and ingredient_names, with RLS
-- (architecture section 3.2; spec R-ING-1 to R-ING-6, FR-REC-5, FR-REC-6, NFR-L10N-5).
--
-- Units and store sections are global reference data: anyone can read them and only
-- migrations write them. Their display names live in the app's locale files
-- (units.*, sections.*), keyed by the part of the ID after the dot.
--
-- Ingredients are either catalog items (household_id is null, read-only to clients,
-- filled by seed migrations) or a household's own items (household_id set, isolated by
-- RLS). Ingredient names are stored per locale in ingredient_names, because the catalog
-- grows without app releases and households name their own items. Nothing is ever
-- matched or merged on a name: only IDs are compared (R-ING-6).

-- ---------------------------------------------------------------------------
-- Units (R-ING-2). Each regional size is its own ID.
-- ---------------------------------------------------------------------------
create table public.units (
  id text primary key check (id ~ '^unit\.[a-z0-9_]+$'),
  dimension text not null check (dimension in ('mass', 'volume', 'count')),
  -- Factor to the base unit (g, ml or each). Null for "a pinch" and "a dash", which have
  -- no base conversion, are never merged and are shown as written (R-ING-5).
  to_base numeric check (to_base > 0),
  -- Unit systems the unit belongs to, for ordering the unit picker (FR-REC-5).
  systems text[] not null check (systems <@ array['us_customary', 'metric']::text[]),
  -- Regions where this is the size a plain word means, for example "tbsp" is unit.tbsp_au
  -- in AU. Empty when the unit is the same everywhere.
  regions text[] not null default '{}' check (regions <@ array['US', 'GB', 'AU']::text[]),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Factors match src/i18n/units.ts, which carries more precision than the spec's table.
insert into public.units (id, dimension, to_base, systems, regions) values
  ('unit.g', 'mass', 1, '{metric,us_customary}', '{}'),
  ('unit.kg', 'mass', 1000, '{metric}', '{}'),
  ('unit.oz', 'mass', 28.3495, '{us_customary}', '{}'),
  ('unit.lb', 'mass', 453.592, '{us_customary}', '{}'),
  ('unit.ml', 'volume', 1, '{metric,us_customary}', '{}'),
  ('unit.l', 'volume', 1000, '{metric}', '{}'),
  ('unit.tsp_us', 'volume', 4.92892, '{us_customary}', '{US}'),
  ('unit.tbsp_us', 'volume', 14.7868, '{us_customary}', '{US}'),
  ('unit.cup_us', 'volume', 236.588, '{us_customary}', '{US}'),
  ('unit.floz_us', 'volume', 29.5735, '{us_customary}', '{US}'),
  ('unit.pint_us', 'volume', 473.176, '{us_customary}', '{US}'),
  ('unit.qt_us', 'volume', 946.353, '{us_customary}', '{US}'),
  ('unit.tsp_metric', 'volume', 5, '{metric}', '{GB,AU}'),
  ('unit.tbsp_metric', 'volume', 15, '{metric}', '{GB}'),
  ('unit.tbsp_au', 'volume', 20, '{metric}', '{AU}'),
  ('unit.cup_metric', 'volume', 250, '{metric}', '{GB,AU}'),
  ('unit.pint_imperial', 'volume', 568.261, '{metric}', '{GB,AU}'),
  ('unit.floz_imperial', 'volume', 28.4131, '{metric}', '{GB,AU}'),
  ('unit.each', 'count', 1, '{metric,us_customary}', '{}'),
  ('unit.pinch', 'count', null, '{metric,us_customary}', '{}'),
  ('unit.dash', 'count', null, '{metric,us_customary}', '{}');

-- ---------------------------------------------------------------------------
-- Store sections. The default order is the aisle order of a typical store; regional
-- orders can follow without changing the IDs.
-- ---------------------------------------------------------------------------
create table public.store_sections (
  id text primary key check (id ~ '^section\.[a-z0-9_]+$'),
  default_order smallint not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.store_sections (id, default_order) values
  ('section.produce', 10),
  ('section.bakery', 20),
  ('section.meat', 30),
  ('section.seafood', 40),
  ('section.deli', 50),
  ('section.dairy', 60),
  ('section.frozen', 70),
  ('section.pantry', 80),
  ('section.baking', 90),
  ('section.spices', 100),
  ('section.condiments', 110),
  ('section.canned', 120),
  ('section.international', 130),
  ('section.breakfast', 140),
  ('section.snacks', 150),
  ('section.drinks', 160),
  ('section.baby', 170),
  ('section.household', 180),
  ('section.other', 190);

create trigger set_updated_at before update on public.units
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.store_sections
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ingredients
-- ---------------------------------------------------------------------------
create table public.ingredients (
  -- Catalog: ingredient.<slug>, such as ingredient.milk. A household's own:
  -- ingredient.h.<uuid as 32 hex digits>, generated on the device so it works offline.
  id text primary key,
  household_id uuid references public.households (id) on delete cascade,
  default_dimension text not null check (default_dimension in ('mass', 'volume', 'count')),
  -- Lets volume and mass merge for this ingredient (R-UNIT-2).
  density_g_per_ml numeric check (density_g_per_ml > 0),
  section_id text not null default 'section.other' references public.store_sections (id),
  -- The US major allergens and the UK and EU 14 (FR-HH-12). Names are in the locale files.
  allergen_codes text[] not null default '{}' check (
    allergen_codes <@ array[
      'allergen.milk', 'allergen.egg', 'allergen.fish', 'allergen.crustacean',
      'allergen.tree_nut', 'allergen.peanut', 'allergen.wheat', 'allergen.soy',
      'allergen.sesame', 'allergen.gluten', 'allergen.celery', 'allergen.mustard',
      'allergen.sulphite', 'allergen.lupin', 'allergen.mollusc'
    ]::text[]
  ),
  -- Added to a new household's pantry (FR-PAN-1). Catalog items only.
  is_default_staple boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (household_id is null and id ~ '^ingredient\.[a-z0-9_]+$')
    or (household_id is not null and id ~ '^ingredient\.h\.[0-9a-f]{32}$' and not is_default_staple)
  )
);

create index ingredients_household_id_idx on public.ingredients (household_id)
  where household_id is not null;

create table public.ingredient_names (
  ingredient_id text not null references public.ingredients (id) on delete cascade,
  locale text not null check (locale in ('en-US', 'en-GB', 'en-AU')),
  -- A copy of the ingredient's household_id, so policies need no join (architecture
  -- section 4). Null for catalog names. A trigger keeps it in step.
  household_id uuid references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  plural text check (char_length(plural) between 1 and 100),
  synonyms text[] not null default '{}' check (cardinality(synonyms) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (ingredient_id, locale)
);

create index ingredient_names_household_id_idx on public.ingredient_names (household_id)
  where household_id is not null;

create trigger set_updated_at before update on public.ingredients
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.ingredient_names
  for each row execute function private.set_updated_at();

-- An ingredient keeps its ID and household for life.
create function private.check_ingredient_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.household_id is distinct from old.household_id then
    raise exception 'an ingredient cannot change its ID or household' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_ingredient_update before update on public.ingredients
  for each row execute function private.check_ingredient_update();

-- A name's household_id must match its ingredient's (architecture section 4).
create function private.check_ingredient_name_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.ingredient_id <> old.ingredient_id or new.locale <> old.locale) then
    raise exception 'a name cannot move to another ingredient or locale' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.ingredients i
    where i.id = new.ingredient_id and i.household_id is not distinct from new.household_id
  ) then
    raise exception 'household_id does not match the ingredient''s household' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_ingredient_name_household before insert or update on public.ingredient_names
  for each row execute function private.check_ingredient_name_household();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.units enable row level security;
alter table public.store_sections enable row level security;
alter table public.ingredients enable row level security;
alter table public.ingredient_names enable row level security;

-- Reference tables are read-only to every client.
revoke insert, update, delete, truncate on public.units, public.store_sections
  from anon, authenticated;
create policy "Anyone can read units"
  on public.units for select to anon, authenticated using (true);
create policy "Anyone can read store sections"
  on public.store_sections for select to anon, authenticated using (true);

-- The anonymous role reads the catalog only (architecture section 4).
revoke insert, update, delete, truncate on public.ingredients, public.ingredient_names from anon;
-- Removing a household ingredient is a soft delete (deleted_at), so it syncs (section 5).
revoke delete, truncate on public.ingredients, public.ingredient_names from authenticated;

create policy "Anyone can read the catalog"
  on public.ingredients for select to anon, authenticated
  using (household_id is null);
create policy "Members can read their household's ingredients"
  on public.ingredients for select to authenticated
  using (household_id is not null and private.household_role(household_id) is not null);
-- Recipes are written by parents and family; caregivers read them (spec section 2.2).
create policy "Parents and family can add household ingredients"
  on public.ingredients for insert to authenticated
  with check (household_id is not null and private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit household ingredients"
  on public.ingredients for update to authenticated
  using (household_id is not null and private.household_role(household_id) in ('parent', 'family'))
  with check (household_id is not null and private.household_role(household_id) in ('parent', 'family'));

create policy "Anyone can read catalog names"
  on public.ingredient_names for select to anon, authenticated
  using (household_id is null);
create policy "Members can read their household's ingredient names"
  on public.ingredient_names for select to authenticated
  using (household_id is not null and private.household_role(household_id) is not null);
create policy "Parents and family can name household ingredients"
  on public.ingredient_names for insert to authenticated
  with check (household_id is not null and private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can rename household ingredients"
  on public.ingredient_names for update to authenticated
  using (household_id is not null and private.household_role(household_id) in ('parent', 'family'))
  with check (household_id is not null and private.household_role(household_id) in ('parent', 'family'));
