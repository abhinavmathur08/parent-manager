-- H-02.2: onboarding people, allergies and diets (FR-ONB-2 to FR-ONB-7, FR-HH-12, D-6).
--
-- - household_people.due_month: the due month only, for an expecting household, never a
--   full date (FR-ONB-4, NFR-SEC-4, decision D-6).
-- - person_dietary codes are limited to the fixed allergen and diet lists (FR-HH-12).
-- - Removing a person removes their diets and allergies too (H-05).
-- - public.complete_onboarding() creates the household and its people in one transaction,
--   so an interrupted onboarding never leaves a household without the answers it was given.

-- ---------------------------------------------------------------------------
-- Due month for expecting
-- ---------------------------------------------------------------------------
-- 'YYYY-MM' text rather than a date, so a day can't be stored even by mistake.
alter table public.household_people
  add column due_month text check (due_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  add constraint household_people_due_month_only_expecting
    check (due_month is null or age_band = 'expecting');

-- ---------------------------------------------------------------------------
-- Fixed codes (src/features/ingredients/catalog-ids.ts and src/features/people/codes.ts)
-- ---------------------------------------------------------------------------
alter table public.person_dietary
  add constraint person_dietary_fixed_codes check (
    (type = 'allergy' and code in (
      'allergen.milk', 'allergen.egg', 'allergen.fish', 'allergen.crustacean',
      'allergen.tree_nut', 'allergen.peanut', 'allergen.wheat', 'allergen.soy',
      'allergen.sesame', 'allergen.gluten', 'allergen.celery', 'allergen.mustard',
      'allergen.sulphite', 'allergen.lupin', 'allergen.mollusc'))
    or (type = 'diet' and code in (
      'diet.vegetarian', 'diet.vegan', 'diet.pescatarian', 'diet.halal', 'diet.kosher'))
    or type = 'avoid'
  );

-- ---------------------------------------------------------------------------
-- Removing a person removes their dietary rows (soft deletes, so both sync)
-- ---------------------------------------------------------------------------
create function private.remove_person_dietary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.person_dietary
  set deleted_at = new.deleted_at
  where person_id = new.id and deleted_at is null;
  return new;
end;
$$;

create trigger remove_person_dietary
  after update of deleted_at on public.household_people
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.remove_person_dietary();

-- A removed person can't be given new codes.
create or replace function private.check_person_dietary_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.household_people p
    where p.id = new.person_id and p.household_id = new.household_id
  ) then
    raise exception 'household_id does not match the person''s household' using errcode = '23514';
  end if;
  if new.deleted_at is null and exists (
    select 1 from public.household_people p where p.id = new.person_id and p.deleted_at is not null
  ) then
    raise exception 'the person has been removed' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create the household with its people, allergies and diets
-- ---------------------------------------------------------------------------
-- people is a JSON array of
--   { "display_name": text, "age_band": text, "due_month": text | null, "is_self": bool,
--     "allergies": [code], "diets": [code] }
-- The caller's own entry ("is_self") is linked to their account. Default staples are added
-- by the households trigger (FR-ONB-6).
create function public.complete_onboarding(
  name text,
  region text,
  locale text,
  unit_system text,
  timezone text,
  week_start smallint,
  people jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_household_id uuid;
  person jsonb;
  new_person_id uuid;
  band text;
begin
  if people is null or jsonb_typeof(people) <> 'array' or jsonb_array_length(people) > 20 then
    raise exception 'people must be an array of at most 20' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(people) p where (p ->> 'is_self')::boolean) > 1 then
    raise exception 'only one person can be the caller' using errcode = '22023';
  end if;

  new_household_id := public.create_household(name, region, locale, unit_system, timezone, week_start);

  for person in select * from jsonb_array_elements(people) loop
    band := person ->> 'age_band';
    insert into public.household_people
      (household_id, display_name, kind, age_band, due_month, linked_user_id)
    values (
      new_household_id,
      btrim(person ->> 'display_name'),
      case when band = 'adult' then 'adult' else 'child' end,
      band,
      case when band = 'expecting' then person ->> 'due_month' end,
      case when coalesce((person ->> 'is_self')::boolean, false) then caller end
    )
    returning id into new_person_id;

    -- No allergies or diets for someone not yet born (data minimization, NFR-SEC-4).
    if band <> 'expecting' then
      insert into public.person_dietary (household_id, person_id, type, code)
      select distinct new_household_id, new_person_id, 'allergy', code
      from jsonb_array_elements_text(coalesce(person -> 'allergies', '[]')) code
      union
      select distinct new_household_id, new_person_id, 'diet', code
      from jsonb_array_elements_text(coalesce(person -> 'diets', '[]')) code;
    end if;
  end loop;

  return new_household_id;
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, text, text, smallint, jsonb)
  from public;
grant execute on function public.complete_onboarding(text, text, text, text, text, smallint, jsonb)
  to authenticated;
