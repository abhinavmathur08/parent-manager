-- H-06.1 spike only: a throwaway table to test sync rules. NOT a migration. The spike
-- workflow applies it to a disposable local stack after the real migrations have run.
create table public.spike_items (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by uuid,
  version integer not null default 1,
  deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.spike_items enable row level security;
revoke all on public.spike_items from anon;
revoke delete, truncate on public.spike_items from authenticated;

create policy "Members read" on public.spike_items for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members insert" on public.spike_items for insert to authenticated
  with check (private.household_role(household_id) is not null);
create policy "Members update" on public.spike_items for update to authenticated
  using (private.household_role(household_id) is not null)
  with check (private.household_role(household_id) is not null);

alter publication supabase_realtime add table public.spike_items;

-- The server owns timestamps, versions and the who-and-when of check-offs.
create function private.spike_items_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := clock_timestamp();
  new.updated_at := new.created_at;
  new.version := 1;
  new.deleted_at := case when new.deleted then new.created_at end;
  if new.checked then
    new.checked_at := new.created_at;
    new.checked_by := (select auth.uid());
  else
    new.checked_at := null;
    new.checked_by := null;
  end if;
  return new;
end;
$$;

-- Conflict rules (architecture section 5). The plugin sends the whole row, including the
-- `version` the device last saw, so the server can tell a stale write from a fresh one.
create function private.spike_items_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  stale boolean := new.version is distinct from old.version;
begin
  -- Deletes are tombstones: once deleted, a row never comes back.
  if old.deleted then
    return old;
  end if;

  new.id := old.id;
  new.household_id := old.household_id;
  new.created_at := old.created_at;

  -- A stale "unchecked" can't override a newer "checked".
  if old.checked and not new.checked and stale then
    new.checked := true;
  end if;

  if new.checked and not old.checked then
    new.checked_at := clock_timestamp();
    new.checked_by := (select auth.uid());
  elsif new.checked then
    new.checked_at := old.checked_at;
    new.checked_by := old.checked_by;
  else
    new.checked_at := null;
    new.checked_by := null;
  end if;

  if new.deleted then
    new.deleted_at := clock_timestamp();
  end if;

  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger before_insert before insert on public.spike_items
  for each row execute function private.spike_items_before_insert();
create trigger before_update before update on public.spike_items
  for each row execute function private.spike_items_before_update();
