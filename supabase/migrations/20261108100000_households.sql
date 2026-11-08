-- H-01.1: profiles, households, household_members and invitations, with the
-- private.household_role() helper and row-level security (architecture section 4, NFR-SEC-2).
--
-- Clients never write household_members or invitations directly. Creating a household
-- goes through public.create_household(); invitations and membership changes get their
-- own RPCs in H-03.1 and H-04.1.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Server-set timestamps. Client clocks are never trusted (architecture section 5).
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  region text not null check (region in ('US', 'GB', 'AU')),
  locale text not null check (locale in ('en-US', 'en-GB', 'en-AU')),
  unit_system text not null check (unit_system in ('us_customary', 'metric')),
  timezone text not null,
  -- ISO weekday the household's week starts on: 1 is Monday, 7 is Sunday.
  week_start smallint not null check (week_start between 1 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 100),
  locale text check (locale in ('en-US', 'en-GB', 'en-AU')),
  active_household_id uuid references public.households (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('parent', 'family', 'caregiver')),
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (household_id, user_id)
);

create index household_members_user_id_idx on public.household_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('parent', 'family', 'caregiver')),
  invited_by uuid references auth.users (id) on delete set null,
  -- Only the token's hash is stored, never the token (architecture section 3.1).
  token_hash text not null unique,
  email text check (char_length(email) <= 320),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index invitations_household_id_idx on public.invitations (household_id);

create trigger set_updated_at before update on public.households
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.household_members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.invitations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------

-- The caller's role in a household, or null if they aren't an active member of it.
-- SECURITY DEFINER so policies can read household_members without recursing into its RLS.
create function private.household_role(target_household_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.household_members m
  join public.households h on h.id = m.household_id
  where m.household_id = target_household_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.deleted_at is null
    and h.deleted_at is null
$$;

-- Whether the caller and another user are active members of the same household.
create function private.shares_household(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other_user_id
      and mine.status = 'active' and mine.deleted_at is null
      and theirs.status = 'active' and theirs.deleted_at is null
  )
$$;

revoke all on function private.household_role(uuid) from public;
revoke all on function private.shares_household(uuid) from public;
grant execute on function private.household_role(uuid) to authenticated;
grant execute on function private.shares_household(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.household_members enable row level security;
alter table public.invitations enable row level security;

-- The anonymous role gets nothing here (architecture section 4).
revoke all on public.households, public.profiles, public.household_members, public.invitations
  from anon;

-- Membership and invitations change only through RPCs that check the caller's role.
revoke insert, update, delete, truncate on public.household_members, public.invitations
  from authenticated;
-- Households are created by public.create_household() and deleted by a later RPC.
revoke insert, delete, truncate on public.households from authenticated;
-- Profiles are created by the auth.users trigger and deleted with the account.
revoke insert, delete, truncate on public.profiles from authenticated;

create policy "Members can read their household"
  on public.households for select to authenticated
  using (private.household_role(id) is not null);

create policy "Parents can update their household"
  on public.households for update to authenticated
  using (private.household_role(id) = 'parent')
  with check (private.household_role(id) = 'parent');

create policy "Members can read their household's members"
  on public.household_members for select to authenticated
  using (private.household_role(household_id) is not null);

create policy "Parents can read their household's invitations"
  on public.invitations for select to authenticated
  using (private.household_role(household_id) = 'parent');

create policy "Users can read their own profile and their household members' profiles"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_household(id));

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (active_household_id is null or private.household_role(active_household_id) is not null)
  );

-- ---------------------------------------------------------------------------
-- Profiles for new accounts
-- ---------------------------------------------------------------------------

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: create a household
-- ---------------------------------------------------------------------------

-- Creates a household with the caller as its first parent and makes it their active
-- household. Phase 1 allows one household per account (spec section 2.1), so a caller who
-- is already an active member somewhere is refused.
create function public.create_household(
  name text,
  region text,
  locale text,
  unit_system text,
  timezone text,
  week_start smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_household_id uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.household_members m
    where m.user_id = caller and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'already a member of a household' using errcode = 'P0001',
      hint = 'household.already_member';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = timezone) then
    raise exception 'unknown timezone' using errcode = '22023', hint = 'household.invalid_timezone';
  end if;

  insert into public.households (name, region, locale, unit_system, timezone, week_start)
  values (name, region, locale, unit_system, timezone, week_start)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, caller, 'parent');

  update public.profiles set active_household_id = new_household_id where id = caller;

  return new_household_id;
end;
$$;

revoke all on function public.create_household(text, text, text, text, text, smallint) from public;
grant execute on function public.create_household(text, text, text, text, text, smallint)
  to authenticated;
