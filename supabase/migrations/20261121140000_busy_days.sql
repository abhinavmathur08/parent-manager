-- B-01.1: busy blocks and busy-day overrides (architecture section 3.5; spec FR2-BUSY-4,
-- FR2-BUSY-5, FR2-DEV-5, FR2-DEV-6, R2-BUSY-1, R2-BUSY-3; decisions D-14, D-15 and D-18).
--
-- Busy days are worked out on the device (src/features/calendar/busy.ts) from the synced events,
-- busy blocks and overrides, so they work offline. The thresholds are a server setting
-- (R2-PAY-1). Detecting, marking and showing busy days is free (D-15): nothing here reads
-- entitlements.
--
-- busy_blocks: a member's busy times from their device calendar (D-14). A block holds only the
-- member, start and end, never a title, place or notes (R2-BUSY-3); a database test checks the
-- table has no text columns. Parents read every block (C9); each member writes, and reads back,
-- only their own.
--
-- busy_day_overrides: a parent or family member marks a day busy or not busy (C8, FR2-BUSY-4).
-- One row per household and date, with an ID from stableId('busy_day_override', household, date)
-- so two devices marking the same day offline write one row. A tombstone never changes
-- (H-06.3), so a client never deletes an override: clearing it sets `busy` to null and the day
-- follows the rule again.

-- ---------------------------------------------------------------------------
-- Settings: the busy-day rule (R2-BUSY-1, PROPOSED numbers), in the household's timezone.
-- Times are minutes after midnight; booked_minutes is the union of timed events and parents'
-- busy blocks inside the day window that makes a day busy.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values (
  'calendar.busy_rule',
  jsonb_build_object(
    'dinner_start', 960, 'dinner_end', 1140,
    'day_start', 420, 'day_end', 1260,
    'booked_minutes', 180)
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.busy_blocks (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- Set by the server to the writer, and never changed.
  user_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Blocks are made for the next 14 days (FR2-DEV-4); a day-long cap keeps a bad clock or a
  -- multi-day device event from marking a week busy.
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);

create table public.busy_day_overrides (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- The day in the household's timezone.
  date date not null,
  -- true: marked busy; false: marked not busy; null: cleared, the rule decides.
  busy boolean,
  -- Set by the server, never the client.
  set_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index busy_blocks_household_starts_at_idx on public.busy_blocks (household_id, starts_at);
create index busy_blocks_user_id_idx on public.busy_blocks (user_id);
-- Tombstones included, so a date keeps one row for life.
create unique index busy_day_overrides_household_date_key
  on public.busy_day_overrides (household_id, date);
create index busy_day_overrides_set_by_idx on public.busy_day_overrides (set_by);

-- ---------------------------------------------------------------------------
-- Triggers: stamp the writer and keep rows where they belong. Named to run before the sync
-- triggers.
-- ---------------------------------------------------------------------------
create function private.check_busy_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.user_id := (select auth.uid());
  elsif new.user_id <> old.user_id or new.household_id <> old.household_id then
    raise exception 'a busy block cannot move to another member or household'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.check_busy_day_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then
      return new;
    end if;
    if new.date <> old.date or new.household_id <> old.household_id then
      raise exception 'an override cannot move to another day' using errcode = '23514';
    end if;
    if new.deleted_at is not null and pg_trigger_depth() = 1 then
      raise exception 'clear the override (busy = null) instead of deleting it'
        using errcode = '23514';
    end if;
  end if;
  new.set_by := (select auth.uid());
  return new;
end;
$$;

create trigger check_busy_block before insert or update on public.busy_blocks
  for each row execute function private.check_busy_block();
create trigger check_busy_day_override before insert or update on public.busy_day_overrides
  for each row execute function private.check_busy_day_override();

-- Leaving or removal deletes the member's busy blocks from the server at once (FR2-DEV-5), as
-- tombstones that sync to the parents' devices.
create function private.remove_member_busy_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.busy_blocks set deleted_at = now()
  where household_id = new.household_id and user_id = new.user_id and deleted_at is null;
  return null;
end;
$$;

create trigger remove_member_busy_blocks
  after update of status, deleted_at on public.household_members
  for each row
  when (old.status = 'active' and old.deleted_at is null
    and (new.status <> 'active' or new.deleted_at is not null))
  execute function private.remove_member_busy_blocks();

revoke all on function private.check_busy_block() from public;
revoke all on function private.check_busy_day_override() from public;
revoke all on function private.remove_member_busy_blocks() from public;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.busy_blocks enable row level security;
alter table public.busy_day_overrides enable row level security;
revoke all on public.busy_blocks, public.busy_day_overrides from anon;

-- A member reads back their own blocks (the sync layer's insert returns the row), but only
-- parents see anyone else's (C9).
create policy "Parents read every busy block; members read their own"
  on public.busy_blocks for select to authenticated
  using (
    private.household_role(household_id) = 'parent'
    or (user_id = (select auth.uid()) and private.household_role(household_id) is not null)
  );
-- private.check_busy_block sets user_id to the caller before this check runs.
create policy "Members add their own busy blocks"
  on public.busy_blocks for insert to authenticated
  with check (
    user_id = (select auth.uid()) and private.household_role(household_id) is not null
  );
create policy "Members change their own busy blocks"
  on public.busy_blocks for update to authenticated
  using (user_id = (select auth.uid()) and private.household_role(household_id) is not null)
  with check (
    user_id = (select auth.uid()) and private.household_role(household_id) is not null
  );

-- Every member sees the markers (FR2-BUSY-1); parents and family members mark days (C8).
create policy "Members read busy-day overrides"
  on public.busy_day_overrides for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents and family members mark days"
  on public.busy_day_overrides for insert to authenticated
  with check (private.household_role(household_id) in ('parent', 'family'));
create policy "Parents and family members change marks"
  on public.busy_day_overrides for update to authenticated
  using (private.household_role(household_id) in ('parent', 'family'))
  with check (private.household_role(household_id) in ('parent', 'family'));

-- Server timestamps and versions, tombstones, no hard deletes, the pull index and Realtime.
select private.enable_sync('public.busy_blocks');
select private.enable_sync('public.busy_day_overrides');
-- A parent who becomes a family member stops seeing others' blocks without any row changing
-- (C-01.3).
select private.enable_scoped_sync('public.busy_blocks');

-- ---------------------------------------------------------------------------
-- Deletion (A-04.3) and export (A-04.2), FR2-PRIV-1 and FR2-PRIV-2. Busy blocks are in the
-- account export of the member they came from, not the household export.
-- ---------------------------------------------------------------------------
select private.register_for_deletion('public.busy_blocks', 'household_id', 'household');
select private.register_for_deletion('public.busy_blocks', 'user_id', 'user');
select private.register_for_deletion('public.busy_day_overrides', 'household_id', 'household');
select private.register_for_deletion('public.busy_day_overrides', 'set_by', 'user', 'set_null');

select private.register_for_export('public.busy_blocks', 'user', 'user_id');
select private.register_for_export('public.busy_day_overrides', 'household', 'household_id');
