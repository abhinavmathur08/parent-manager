-- H-01.2: household_people, person_dietary, household_entitlements and app_config, with RLS
-- (architecture sections 3.1, 3.3, 4 and 8; NFR-SEC-2, NFR-SEC-4).

-- ---------------------------------------------------------------------------
-- Entitlements: written only by the service role (the RevenueCat webhook, section 8).
-- ---------------------------------------------------------------------------
create table public.household_entitlements (
  household_id uuid primary key references public.households (id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'premium')),
  status text not null default 'active' check (status in ('active', 'grace_period', 'expired')),
  period_ends_at timestamptz,
  purchaser_user_id uuid references auth.users (id) on delete set null,
  rc_app_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.household_entitlements
  for each row execute function private.set_updated_at();

alter table public.household_entitlements enable row level security;
revoke all on public.household_entitlements from anon;
revoke insert, update, delete, truncate on public.household_entitlements from authenticated;

-- Every member sees the same tier (FR-PAY-1). Defined after household_role() is updated below.

-- Every household starts on Free.
create function private.create_free_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.household_entitlements (household_id) values (new.id)
  on conflict (household_id) do nothing;
  return new;
end;
$$;

create trigger create_free_entitlement
  after insert on public.households
  for each row execute function private.create_free_entitlement();

insert into public.household_entitlements (household_id)
select id from public.households
on conflict (household_id) do nothing;

-- When Premium lapses, family members and caregivers keep their membership rows but lose
-- access until it returns (spec section 2, FR-PAY-9; architecture section 8). Parents
-- always keep access.
create or replace function private.household_role(target_household_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.household_members m
  join public.households h on h.id = m.household_id
  left join public.household_entitlements e on e.household_id = m.household_id
  where m.household_id = target_household_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.deleted_at is null
    and h.deleted_at is null
    and (m.role = 'parent' or e.tier = 'premium')
$$;

create policy "Members can read their household's entitlement"
  on public.household_entitlements for select to authenticated
  using (private.household_role(household_id) is not null);

-- ---------------------------------------------------------------------------
-- People the household feeds. Age bands only, never birth dates (section 3.3, NFR-SEC-4).
-- ---------------------------------------------------------------------------
create table public.household_people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  kind text not null check (kind in ('adult', 'child')),
  age_band text not null check (
    age_band in ('expecting', 'infant_0_6m', 'infant_6_12m', 'toddler', 'preschool', 'older_child', 'adult')
  ),
  linked_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((kind = 'adult') = (age_band = 'adult'))
);

create index household_people_household_id_idx on public.household_people (household_id);

create table public.person_dietary (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  person_id uuid not null references public.household_people (id) on delete cascade,
  type text not null check (type in ('allergy', 'diet', 'avoid')),
  -- Fixed identifiers only, never free text (FR-HH-12).
  code text not null check (
    (type = 'allergy' and code ~ '^allergen\.[a-z0-9_]+$')
    or (type = 'diet' and code ~ '^diet\.[a-z0-9_]+$')
    or (type = 'avoid' and code ~ '^ingredient\.[a-z0-9_.]+$')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Each code is its own row, so two parents adding codes at once keep both (spec section 3.3).
create unique index person_dietary_unique_live_code
  on public.person_dietary (person_id, type, code) where deleted_at is null;
create index person_dietary_household_id_idx on public.person_dietary (household_id);

create trigger set_updated_at before update on public.household_people
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.person_dietary
  for each row execute function private.set_updated_at();

-- A linked member must belong to the same household, and a person can't change household.
create function private.check_household_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.household_id <> old.household_id then
    raise exception 'a person cannot move household' using errcode = '23514';
  end if;
  if new.linked_user_id is not null and not exists (
    select 1 from public.household_members m
    where m.household_id = new.household_id and m.user_id = new.linked_user_id
      and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'linked user is not a member of this household' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_household_person before insert or update on public.household_people
  for each row execute function private.check_household_person();

-- A dietary row's household_id must match its person's (architecture section 4).
create function private.check_person_dietary_household()
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
  return new;
end;
$$;

create trigger check_person_dietary_household before insert or update on public.person_dietary
  for each row execute function private.check_person_dietary_household();

alter table public.household_people enable row level security;
alter table public.person_dietary enable row level security;
revoke all on public.household_people, public.person_dietary from anon;
-- Removing a person or a code is a soft delete (deleted_at), so it syncs (section 5).
revoke delete, truncate on public.household_people, public.person_dietary from authenticated;

-- Parents and family members manage people and diets; caregivers read them (spec 2.2, rows 13 and 14).
create policy "Members can read their household's people"
  on public.household_people for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family can add people"
  on public.household_people for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit people"
  on public.household_people for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

create policy "Members can read their household's diets"
  on public.person_dietary for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family can add diets"
  on public.person_dietary for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family can edit diets"
  on public.person_dietary for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

-- ---------------------------------------------------------------------------
-- App config: global, readable by anyone, written only by the service role.
-- ---------------------------------------------------------------------------
create table public.app_config (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.app_config
  for each row execute function private.set_updated_at();

alter table public.app_config enable row level security;
revoke insert, update, delete, truncate on public.app_config from anon, authenticated;

create policy "Anyone can read app config"
  on public.app_config for select to anon, authenticated
  using (true);
