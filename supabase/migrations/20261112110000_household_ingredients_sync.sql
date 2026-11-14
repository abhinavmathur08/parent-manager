-- R-02.2 (part): household ingredients that work offline (FR-REC-5, R-ING-1, architecture
-- sections 3.2 and 5).
--
-- "Add as new ingredient" in the recipe editor must work offline, and the new ingredient
-- must reach the server before the recipe lines that use it. `ingredients` and
-- `ingredient_names` can't join the sync layer (text IDs, a composite key, catalog rows),
-- so the device writes this synced table instead, and a trigger keeps the household's rows
-- of `ingredients` and `ingredient_names` in step. The outbox sends writes in order, so the
-- ingredient exists before any line that refers to it.
--
-- The ingredient's ID is `ingredient.h.` followed by this row's UUID as 32 hex digits, the
-- format R-01.1 set for household ingredients, so the device knows it at once.

create table public.household_ingredients (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- The name as the household typed it, in the household's locale. User content.
  name text not null check (char_length(btrim(name)) between 1 and 100),
  locale text not null check (locale in ('en-US', 'en-GB', 'en-AU')),
  section_id text not null default 'section.other' references public.store_sections (id),
  default_dimension text not null default 'count'
    check (default_dimension in ('mass', 'volume', 'count')),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Keeps the household's `ingredients` and `ingredient_names` rows in step with this table.
create function private.publish_household_ingredient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ingredient constant text := 'ingredient.h.' || replace(new.id::text, '-', '');
begin
  insert into public.ingredients as i (id, household_id, default_dimension, section_id, deleted_at)
  values (ingredient, new.household_id, new.default_dimension, new.section_id, new.deleted_at)
  on conflict (id) do update
    set default_dimension = excluded.default_dimension,
        section_id = excluded.section_id,
        deleted_at = excluded.deleted_at
    where i.household_id = excluded.household_id;
  if not found then
    raise exception 'the ingredient belongs to another household' using errcode = '23514';
  end if;

  insert into public.ingredient_names as n (ingredient_id, locale, household_id, name, deleted_at)
  values (ingredient, new.locale, new.household_id, btrim(new.name), new.deleted_at)
  on conflict (ingredient_id, locale) do update
    set name = excluded.name,
        deleted_at = excluded.deleted_at;
  return null;
end;
$$;

revoke all on function private.publish_household_ingredient() from public;

create trigger publish_household_ingredient
  after insert or update on public.household_ingredients
  for each row execute function private.publish_household_ingredient();

-- Parents and family members add ingredients, as they write recipes; caregivers read them
-- (architecture section 3.3).
alter table public.household_ingredients enable row level security;
revoke all on public.household_ingredients from anon;

create policy "Members can read their household's own ingredients"
  on public.household_ingredients for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family can add ingredients"
  on public.household_ingredients for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit ingredients"
  on public.household_ingredients for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

select private.enable_sync('public.household_ingredients');
