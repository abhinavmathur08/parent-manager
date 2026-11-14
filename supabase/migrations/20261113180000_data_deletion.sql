-- A-04.3: account deletion and household deletion (FR-PRIV-3, FR-PRIV-4, FR-PRIV-7).
--
-- Everything goes through one registry, private.deletion_registry, which lists every column
-- that ties a row to a household or to a user. Deleting a household deletes every row
-- registered against it. Deleting an account deletes or anonymizes every row registered
-- against the user, then deletes the auth user. A table that holds household data or user
-- IDs must register its columns in the migration that creates it:
--
--   select private.register_for_deletion('public.recipes', 'household_id', 'household');
--   select private.register_for_deletion('public.recipes', 'created_by', 'user', 'set_null');
--
-- supabase/tests/data_deletion.test.sql fails if a public table has a household_id column,
-- a foreign key to auth.users or households, or a uuid column named *_by or *user_id that
-- isn't registered. Deleting an account also refuses to finish if a registered user column
-- still holds the user's ID afterwards, so a trigger that undoes the anonymizing is caught.

-- ---------------------------------------------------------------------------
-- The registry
-- ---------------------------------------------------------------------------

create table private.deletion_registry (
  table_name regclass not null,
  column_name name not null,
  -- 'household': the column holds a household ID. 'user': the column holds a user ID.
  scope text not null check (scope in ('household', 'user')),
  -- 'delete': the row goes with the household or user. 'set_null': the row stays and the
  -- column is cleared, such as a recipe's creator ("former member") or a pointer to a
  -- deleted household.
  action text not null check (action in ('delete', 'set_null')),
  -- Rows are erased in reverse registration order, so a later table that references an
  -- earlier one is cleared first.
  position int generated always as identity,
  primary key (table_name, column_name)
);

revoke all on private.deletion_registry from public, anon, authenticated;

-- Registers a column for deletion. Checks that it exists, holds a uuid, and is nullable
-- when it's to be set null.
create function private.register_for_deletion(
  target regclass,
  column_name name,
  scope text,
  action text default 'delete'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  col_type text;
  col_not_null boolean;
begin
  select format_type(a.atttypid, a.atttypmod), a.attnotnull into col_type, col_not_null
  from pg_catalog.pg_attribute a
  where a.attrelid = target and a.attname = column_name and a.attnum > 0 and not a.attisdropped;
  if col_type is null then
    raise exception 'register_for_deletion: % has no column %', target, column_name;
  end if;
  if col_type <> 'uuid' then
    raise exception 'register_for_deletion: %.% must be a uuid, not %', target, column_name, col_type;
  end if;
  if action = 'set_null' and col_not_null then
    raise exception 'register_for_deletion: %.% is not null, so it cannot be set null',
      target, column_name;
  end if;
  insert into private.deletion_registry (table_name, column_name, scope, action)
  values (target, column_name, scope, action);
end;
$$;

revoke all on function private.register_for_deletion(regclass, name, text, text) from public;

-- ---------------------------------------------------------------------------
-- Erasure mode
-- ---------------------------------------------------------------------------

-- Whether this transaction is erasing data for a deletion. Set only by the functions below,
-- which run as the table owner; triggers that guard rows (sync tombstones, server-set
-- columns such as created_by) must let erasure through.
create function private.is_erasing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('private.erasing', true), '') = 'on'
    and current_user not in ('anon', 'authenticated')
$$;

revoke all on function private.is_erasing() from public;
grant execute on function private.is_erasing() to authenticated;

-- Starts erasure. Until end_erasure(), auth.uid() reads as null, so triggers that stamp the
-- current user (updated_by and the like) can't write the deleted user's ID back. Returns the
-- caller's claims for end_erasure() to put back.
create function private.begin_erasure()
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  saved text[] := array[
    coalesce(current_setting('request.jwt.claim.sub', true), ''),
    coalesce(current_setting('request.jwt.claims', true), '')];
begin
  perform set_config('private.erasing', 'on', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  return saved;
end;
$$;

create function private.end_erasure(saved text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('private.erasing', '', true);
  perform set_config('request.jwt.claim.sub', saved[1], true);
  perform set_config('request.jwt.claims', saved[2], true);
end;
$$;

revoke all on function private.begin_erasure() from public;
revoke all on function private.end_erasure(text[]) from public;

-- The sync rules (H-06.3) keep tombstones unchanged and keep who checked a row. Erasure
-- must still be able to anonymize those rows, so it bypasses both, and bumps the version
-- so devices pull the change. Otherwise unchanged from 20261110100000_sync_rules.sql.
create or replace function private.sync_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  now_ts constant timestamptz := clock_timestamp();
  -- The client sends the version it last saw; anything else means the row moved on since.
  stale constant boolean := new.version is distinct from old.version;
  col text;
  old_json jsonb;
  new_json jsonb;
  was_set boolean;
  is_set boolean;
begin
  if private.is_erasing() then
    new.version := old.version + 1;
    new.updated_at := now_ts;
    return new;
  end if;

  -- A tombstone never changes. Returning the old row answers a late edit with the delete.
  if old.deleted_at is not null then
    return old;
  end if;

  new.id := old.id;
  new.household_id := old.household_id;
  new.created_at := old.created_at;

  if tg_nargs > 0 then
    old_json := to_jsonb(old);
    new_json := to_jsonb(new);
    foreach col in array tg_argv loop
      was_set := coalesce((old_json ->> col)::boolean, false);
      is_set := coalesce((new_json ->> col)::boolean, false);
      if was_set and not is_set and stale then
        is_set := true;
      end if;
      if is_set and not was_set then
        new_json := new_json || jsonb_build_object(
          col, true, col || '_at', now_ts, col || '_by', (select auth.uid()));
      elsif is_set then
        new_json := new_json || jsonb_build_object(
          col, true, col || '_at', old_json -> (col || '_at'), col || '_by', old_json -> (col || '_by'));
      else
        new_json := new_json || jsonb_build_object(col, false, col || '_at', null, col || '_by', null);
      end if;
    end loop;
    new := jsonb_populate_record(new, new_json);
  end if;

  if new.deleted_at is not null then
    new.deleted_at := now_ts;
  end if;
  new.version := old.version + 1;
  new.updated_at := now_ts;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Erasing a household and a user
-- ---------------------------------------------------------------------------

-- Deletes the rows whose column holds the ID, or clears the column.
create function private.erase_rows(target_table regclass, column_name name, action text, id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if action = 'delete' then
    execute format('delete from %s where %I = $1', target_table, column_name) using id;
  else
    execute format('update %s set %I = null where %I = $1', target_table, column_name, column_name)
    using id;
  end if;
end;
$$;

revoke all on function private.erase_rows(regclass, name, text, uuid) from public;

-- Deletes a household and every row registered against it. The caller has already checked
-- who may do this.
create function private.erase_household(target uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  entry record;
  saved text[] := private.begin_erasure();
begin
  for entry in
    select r.table_name, r.column_name, r.action from private.deletion_registry r
    where r.scope = 'household' order by r.position desc
  loop
    perform private.erase_rows(entry.table_name, entry.column_name, entry.action, target);
  end loop;
  delete from public.households h where h.id = target;
  perform private.end_erasure(saved);
end;
$$;

revoke all on function private.erase_household(uuid) from public;

-- The registered user columns that still hold a user's ID, as 'table.column'.
create function private.erasure_leftovers(target uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  entry record;
  found boolean;
  leftovers text[] := '{}';
begin
  for entry in
    select r.table_name, r.column_name from private.deletion_registry r where r.scope = 'user'
  loop
    execute format('select exists (select 1 from %s where %I = $1)', entry.table_name, entry.column_name)
    into found using target;
    if found then
      leftovers := leftovers || (entry.table_name::text || '.' || entry.column_name);
    end if;
  end loop;
  return leftovers;
end;
$$;

revoke all on function private.erasure_leftovers(uuid) from public;

-- Deletes or anonymizes every row registered against a user, then the auth user, which
-- also removes their sessions and sign-in identities. Fails rather than leave any of the
-- user's IDs behind.
create function private.erase_user(target uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  entry record;
  leftovers text[];
  saved text[] := private.begin_erasure();
begin
  for entry in
    select r.table_name, r.column_name, r.action from private.deletion_registry r
    where r.scope = 'user' order by r.position desc
  loop
    perform private.erase_rows(entry.table_name, entry.column_name, entry.action, target);
  end loop;

  delete from auth.users u where u.id = target;
  perform private.end_erasure(saved);

  leftovers := private.erasure_leftovers(target);
  if cardinality(leftovers) > 0 then
    raise exception 'account deletion left rows behind: %', array_to_string(leftovers, ', ');
  end if;
end;
$$;

revoke all on function private.erase_user(uuid) from public;

-- Whether the caller signed in (or re-authenticated) in the last 10 minutes, from the
-- sign-in times in the token's amr claim. Deleting needs a fresh sign-in (FR-PRIV-3), so a
-- borrowed unlocked phone isn't enough.
create function private.recently_authenticated()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select max((m ->> 'timestamp')::bigint)
     from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
     where jsonb_typeof(m -> 'timestamp') = 'number')
    >= extract(epoch from now()) - 600,
    false)
$$;

revoke all on function private.recently_authenticated() from public;

create function private.require_recent_authentication()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.recently_authenticated() then
    raise exception 'sign in again to confirm' using errcode = '42501',
      hint = 'account.reauthentication_required';
  end if;
end;
$$;

revoke all on function private.require_recent_authentication() from public;

-- ---------------------------------------------------------------------------
-- Account deletion (FR-PRIV-3)
-- ---------------------------------------------------------------------------

-- What deleting the caller's account would do, so the confirmation can name it:
-- 'delete_household' when nobody who could keep the household would remain (the same rule
-- as leaving, FR-HH-8), 'last_parent' when they must promote someone or delete the
-- household first (FR-HH-14), 'leave' when the household carries on, and 'no_household'.
create function private.account_deletion_outcome(caller uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  m public.household_members;
  household_name text;
  outcome text;
begin
  select hm.* into m from public.household_members hm
  join public.households h on h.id = hm.household_id and h.deleted_at is null
  where hm.user_id = caller and hm.status = 'active' and hm.deleted_at is null
  limit 1;

  if m.household_id is null then
    return jsonb_build_object('outcome', 'no_household');
  end if;

  select h.name into household_name from public.households h where h.id = m.household_id;
  if private.count_members(m.household_id, 'parent', caller)
      + private.count_members(m.household_id, 'family', caller) = 0 then
    outcome := 'delete_household';
  elsif m.role = 'parent' and private.count_members(m.household_id, 'parent', caller) = 0 then
    outcome := 'last_parent';
  else
    outcome := 'leave';
  end if;

  return jsonb_build_object(
    'outcome', outcome,
    'household_id', m.household_id,
    'household_name', household_name);
end;
$$;

revoke all on function private.account_deletion_outcome(uuid) from public;

create function public.account_deletion_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return private.account_deletion_outcome(caller);
end;
$$;

-- Deletes the caller's account. Needs a sign-in in the last 10 minutes. If nobody who could
-- keep the household would remain, the household and all its data go too; otherwise the
-- household carries on without them, and what they created stays, attributed to a former
-- member. The last parent with others must promote someone or delete the household first.
-- Returns whether the household was deleted.
create function public.delete_account()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  preview jsonb;
  target uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform private.require_recent_authentication();

  -- Locks the household, so a partner leaving at the same moment can't strand it.
  preview := private.account_deletion_outcome(caller);
  target := (preview ->> 'household_id')::uuid;
  if target is not null then
    perform 1 from public.households h where h.id = target for update;
    preview := private.account_deletion_outcome(caller);
  end if;

  if preview ->> 'outcome' = 'last_parent' then
    raise exception 'the household needs a parent' using errcode = 'P0001',
      hint = 'member.last_parent';
  end if;
  if preview ->> 'outcome' = 'delete_household' then
    perform private.erase_household(target);
  end if;
  perform private.erase_user(caller);

  return jsonb_build_object('household_deleted', preview ->> 'outcome' = 'delete_household');
end;
$$;

revoke all on function public.account_deletion_preview() from public;
revoke all on function public.delete_account() from public;
grant execute on function public.account_deletion_preview() to authenticated;
grant execute on function public.delete_account() to authenticated;

-- Leaving as the only member deletes the household (FR-HH-8) through the registry too, so
-- tables that don't cascade from households are covered. Otherwise unchanged from
-- 20261111140000_leave_household.sql.
create or replace function public.leave_household(household_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target uuid := household_id;
  my_role text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  perform 1 from public.households h where h.id = target for update;

  -- Not household_role(): a paused member can leave too.
  select m.role into my_role from public.household_members m
  where m.household_id = target and m.user_id = caller
    and m.status = 'active' and m.deleted_at is null;
  if my_role is null then
    raise exception 'not a member' using errcode = 'P0002', hint = 'member.not_found';
  end if;

  if private.count_members(target, 'parent', caller) + private.count_members(target, 'family', caller) = 0 then
    perform private.erase_household(target);
    update public.profiles p set active_household_id = null where p.id = caller;
    return jsonb_build_object('deleted', true);
  end if;

  if my_role = 'parent' and private.count_members(target, 'parent', caller) = 0 then
    raise exception 'the household needs a parent' using errcode = 'P0001',
      hint = 'member.last_parent';
  end if;

  update public.household_members m set status = 'left'
  where m.household_id = target and m.user_id = caller;
  update public.profiles p set active_household_id = null
  where p.id = caller and p.active_household_id = target;
  return jsonb_build_object('deleted', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Household deletion with the other parent's confirmation (FR-PRIV-7)
-- ---------------------------------------------------------------------------

-- A parent's request to delete the household. With two parents, the other confirms within
-- 7 days or it lapses. One open request per household; a lapsed one is replaced.
create table public.household_deletion_requests (
  household_id uuid primary key references public.households (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.household_deletion_requests enable row level security;
revoke all on public.household_deletion_requests from anon;
revoke insert, update, delete, truncate on public.household_deletion_requests from authenticated;

-- Every member sees a pending request, so nobody is surprised (FR-PRIV-7: all are told).
create policy "Members can read their household's deletion request"
  on public.household_deletion_requests for select to authenticated
  using (private.household_role(household_id) is not null);

-- Asks to delete the caller's household, or deletes it at once when they're its only
-- parent. Needs a recent sign-in. Returns 'deleted' or 'requested' with the expiry.
create function public.request_household_deletion(household_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target uuid := household_id;
  expires timestamptz := now() + interval '7 days';
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform 1 from public.households h where h.id = target for update;
  if private.household_role(target) is distinct from 'parent' then
    raise exception 'only a parent can delete the household' using errcode = '42501',
      hint = 'household.parent_only';
  end if;
  perform private.require_recent_authentication();

  if private.count_members(target, 'parent', caller) = 0 then
    perform private.erase_household(target);
    return jsonb_build_object('status', 'deleted');
  end if;

  if exists (
    select 1 from public.household_deletion_requests r
    where r.household_id = target and r.expires_at > now() and r.requested_by <> caller
  ) then
    raise exception 'the other parent already asked' using errcode = 'P0001',
      hint = 'household.deletion_pending';
  end if;

  insert into public.household_deletion_requests as r (household_id, requested_by, expires_at)
  values (target, caller, expires)
  on conflict on constraint household_deletion_requests_pkey do update
    set requested_by = excluded.requested_by, expires_at = excluded.expires_at,
      created_at = now();
  return jsonb_build_object('status', 'requested', 'expires_at', expires);
end;
$$;

-- The other parent confirms the request, which deletes the household. Needs a recent
-- sign-in, and an open request from someone else.
create function public.confirm_household_deletion(household_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target uuid := household_id;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform 1 from public.households h where h.id = target for update;
  if private.household_role(target) is distinct from 'parent' then
    raise exception 'only a parent can delete the household' using errcode = '42501',
      hint = 'household.parent_only';
  end if;
  if not exists (
    select 1 from public.household_deletion_requests r
    where r.household_id = target and r.expires_at > now() and r.requested_by <> caller
  ) then
    raise exception 'no request to confirm' using errcode = 'P0002',
      hint = 'household.no_deletion_request';
  end if;
  perform private.require_recent_authentication();
  perform private.erase_household(target);
end;
$$;

-- Either parent withdraws or declines the request.
create function public.cancel_household_deletion(household_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target uuid := household_id;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if private.household_role(target) is distinct from 'parent' then
    raise exception 'only a parent can do this' using errcode = '42501',
      hint = 'household.parent_only';
  end if;
  delete from public.household_deletion_requests r where r.household_id = target;
end;
$$;

revoke all on function public.request_household_deletion(uuid) from public;
revoke all on function public.confirm_household_deletion(uuid) from public;
revoke all on function public.cancel_household_deletion(uuid) from public;
grant execute on function public.request_household_deletion(uuid) to authenticated;
grant execute on function public.confirm_household_deletion(uuid) to authenticated;
grant execute on function public.cancel_household_deletion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recipe authorship (R-02.1) keeps created_by on every update, which would put a deleted
-- user's ID back. While erasing, the row is left as erasure sets it.
-- ---------------------------------------------------------------------------
create or replace function private.set_recipe_authors()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function private.set_recipe_authors() from public;

-- ---------------------------------------------------------------------------
-- Registrations for the tables on main so far (to the planner, P-01)
-- ---------------------------------------------------------------------------

-- Household data, deleted with the household.
select private.register_for_deletion('public.profiles', 'active_household_id', 'household', 'set_null');
select private.register_for_deletion('public.household_members', 'household_id', 'household');
select private.register_for_deletion('public.invitations', 'household_id', 'household');
select private.register_for_deletion('public.household_entitlements', 'household_id', 'household');
select private.register_for_deletion('public.household_people', 'household_id', 'household');
select private.register_for_deletion('public.person_dietary', 'household_id', 'household');
select private.register_for_deletion('public.ingredients', 'household_id', 'household');
select private.register_for_deletion('public.ingredient_names', 'household_id', 'household');
select private.register_for_deletion('public.pantry_items', 'household_id', 'household');
select private.register_for_deletion('public.ai_import_jobs', 'household_id', 'household');
select private.register_for_deletion('public.ai_usage', 'household_id', 'household');
-- Registered after ingredients, so recipe lines go before the household ingredients they use;
-- plan entries go before the recipes they point to.
select private.register_for_deletion('public.household_ingredients', 'household_id', 'household');
select private.register_for_deletion('public.recipes', 'household_id', 'household');
select private.register_for_deletion('public.recipe_ingredients', 'household_id', 'household');
select private.register_for_deletion('public.recipe_steps', 'household_id', 'household');
select private.register_for_deletion('public.plan_entries', 'household_id', 'household');
select private.register_for_deletion('public.plan_entry_portions', 'household_id', 'household');
select private.register_for_deletion('public.household_deletion_requests', 'household_id', 'household');

-- A user's own rows, deleted with the account.
select private.register_for_deletion('public.profiles', 'id', 'user');
select private.register_for_deletion('public.household_members', 'user_id', 'user');
select private.register_for_deletion('public.invite_attempts', 'user_id', 'user');
select private.register_for_deletion('public.household_deletion_requests', 'requested_by', 'user');

-- Shared rows that stay with the household, no longer naming the user.
select private.register_for_deletion('public.invitations', 'invited_by', 'user', 'set_null');
select private.register_for_deletion('public.invitations', 'accepted_by', 'user', 'set_null');
select private.register_for_deletion('public.household_entitlements', 'purchaser_user_id', 'user', 'set_null');
select private.register_for_deletion('public.household_people', 'linked_user_id', 'user', 'set_null');
select private.register_for_deletion('public.ai_import_jobs', 'user_id', 'user', 'set_null');
select private.register_for_deletion('public.recipes', 'created_by', 'user', 'set_null');
select private.register_for_deletion('public.recipes', 'updated_by', 'user', 'set_null');
