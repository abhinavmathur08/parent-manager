-- B-01.4: each day's busy state, published by parents' devices for every member (D-23,
-- R2-BUSY-1, R2-BUSY-2, NFR2-SEC-1; architecture section 3.5).
--
-- Family members' and caregivers' devices hold only shared events and their own busy blocks,
-- so they can't work out a day made busy by a parent's private event. Parents' devices run
-- the busy-day engine (src/features/calendar/busy.ts) for a rolling window, today plus 13
-- days, and write each day's result here: the date, busy or not, and the fixed reason. Nothing
-- else: no titles, times, durations or event IDs, so a row says no more than the marker does.
--
-- One row per household and date, with an ID from stableId('busy_day', household, date), so
-- two parents publishing the same day write one row. Devices write only when their result
-- differs from the row, so parents with the same synced data agree and stop writing. A
-- tombstone never changes (H-06.3), so a client never deletes a row; past days simply stay.

create table public.busy_days (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- The day in the household's timezone.
  date date not null,
  busy boolean not null,
  -- A fixed identifier, never free text: why the day is busy (FR2-BUSY-1).
  reason text check (reason in ('dinner', 'booked', 'marked')),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((busy and reason is not null) or (not busy and reason is null))
);

-- Tombstones included, so a date keeps one row for life.
create unique index busy_days_household_date_key on public.busy_days (household_id, date);

-- Keeps a row on its date, and refuses a client's tombstone (it would block that date's
-- stable ID for good). Named to run before the sync triggers.
create function private.check_busy_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_erasing() or old.deleted_at is not null then
    return new;
  end if;
  if new.date <> old.date or new.household_id <> old.household_id then
    raise exception 'a busy day cannot move to another day' using errcode = '23514';
  end if;
  if new.deleted_at is not null and pg_trigger_depth() = 1 then
    raise exception 'publish the day as not busy instead of deleting it' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_busy_day before update on public.busy_days
  for each row execute function private.check_busy_day();
revoke all on function private.check_busy_day() from public;

-- ---------------------------------------------------------------------------
-- RLS: every active member reads (FR2-BUSY-1, R2-BUSY-2); only parents, whose devices see
-- every event and block, write.
-- ---------------------------------------------------------------------------
alter table public.busy_days enable row level security;
revoke all on public.busy_days from anon;

create policy "Members read busy days"
  on public.busy_days for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Parents publish busy days"
  on public.busy_days for insert to authenticated
  with check (private.household_role(household_id) = 'parent');
create policy "Parents update busy days"
  on public.busy_days for update to authenticated
  using (private.household_role(household_id) = 'parent')
  with check (private.household_role(household_id) = 'parent');

-- Server timestamps and versions, tombstones, no hard deletes, the pull index and Realtime.
select private.enable_sync('public.busy_days');

-- Deletion (A-04.3) and export (A-04.2), FR2-PRIV-1 and FR2-PRIV-2.
select private.register_for_deletion('public.busy_days', 'household_id', 'household');
select private.register_for_export('public.busy_days', 'household', 'household_id');
