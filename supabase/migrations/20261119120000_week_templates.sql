-- P-05: saved week templates (spec FR-PLAN-10, FR-PAY-3, FR-PAY-9; architecture section 8).
--
-- Premium only, enforced here: every policy needs private.household_is_premium. When Premium
-- lapses, templates are hidden from the app but kept, and the data export (a security definer
-- function) still includes them. Applying a template reads it, so a free household can't
-- apply one either.
--
-- A template is one row with its entries as JSON: each entry's weekday offset, slot, position,
-- recipe or free text, servings, portions and leftover link within the week. It's read and
-- written online through PostgREST, not synced (templates are Premium, and need a connection).

create table public.week_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- [{ "id", "day" (0 to 6 from the week start), "slot", "position", "recipe_id",
  --    "free_text", "title", "servings", "leftover_of", "portions": [{ "person_id",
  --    "portions", "variant" }] }]
  entries jsonb not null check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index week_templates_household_idx on public.week_templates (household_id, created_at);

create trigger set_updated_at before update on public.week_templates
  for each row execute function private.set_updated_at();

-- The saver is always the caller; it can't be set to someone else.
create function private.stamp_template_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_erasing() then
    new.created_by := case when tg_op = 'INSERT' then (select auth.uid()) else old.created_by end;
  end if;
  return new;
end;
$$;

create trigger stamp_template_creator before insert or update on public.week_templates
  for each row execute function private.stamp_template_creator();

-- PROPOSED (D-9): at most 50 saved templates per household.
create function private.check_template_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('week_templates:' || new.household_id::text, 0));
  if (select count(*) from public.week_templates t where t.household_id = new.household_id)
    >= private.template_limit() then
    raise exception 'the household has the most templates allowed' using errcode = 'P0001',
      hint = 'template.limit';
  end if;
  return new;
end;
$$;

create function private.template_limit()
returns integer
language sql
immutable
set search_path = ''
as $$ select 50 $$;

create trigger check_template_limit before insert on public.week_templates
  for each row execute function private.check_template_limit();

revoke all on function private.stamp_template_creator() from public;
revoke all on function private.check_template_limit() from public;
revoke all on function private.template_limit() from public;

alter table public.week_templates enable row level security;
revoke all on public.week_templates from anon;
revoke truncate on public.week_templates from authenticated;

-- Parents and family members save, rename, delete and apply templates (FR-PLAN-10), and only
-- while the household has Premium (FR-PAY-3).
create policy "Premium parents and family read templates"
  on public.week_templates for select to authenticated
  using (
    private.household_role(household_id) in ('parent', 'family')
    and private.household_is_premium(household_id)
  );

create policy "Premium parents and family save templates"
  on public.week_templates for insert to authenticated
  with check (
    private.household_role(household_id) in ('parent', 'family')
    and private.household_is_premium(household_id)
  );

create policy "Premium parents and family rename templates"
  on public.week_templates for update to authenticated
  using (
    private.household_role(household_id) in ('parent', 'family')
    and private.household_is_premium(household_id)
  )
  with check (
    private.household_role(household_id) in ('parent', 'family')
    and private.household_is_premium(household_id)
  );

create policy "Premium parents and family delete templates"
  on public.week_templates for delete to authenticated
  using (
    private.household_role(household_id) in ('parent', 'family')
    and private.household_is_premium(household_id)
  );

-- ---------------------------------------------------------------------------
-- Deletion (A-04.3) and export (A-04.2)
-- ---------------------------------------------------------------------------
select private.register_for_deletion('public.week_templates', 'household_id', 'household');
select private.register_for_deletion('public.week_templates', 'created_by', 'user', 'set_null');

do $$
begin
  if to_regprocedure('private.register_for_export(regclass, text, text, text[], text)')
    is not null then
    execute $sql$
      select private.register_for_export('public.week_templates', 'household', 'household_id');
    $sql$;
  end if;
end;
$$;
