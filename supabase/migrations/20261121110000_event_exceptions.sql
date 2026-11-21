-- C-01.2 (part 1): exceptions to repeating events (architecture section 3.5; spec FR2-CAL-4,
-- R2-CAL-1, R2-CAL-2).
--
-- Occurrences of a repeat are expanded on the device and never stored (R2-CAL-1). Changing or
-- deleting one occurrence ("this event") stores one exception row for it.
--
-- An occurrence is named by its series and its original date in the household's timezone: a
-- series has at most one occurrence a day (daily, weekly, every 2 weeks or monthly), so the
-- date is enough, and unlike an instant it doesn't shift if the household's timezone changes.
-- The device makes the row's ID with stableId('event_exception', event_id, original_date), so
-- two devices changing the same occurrence offline write one row (R2-CAL-2). The unique index
-- below holds even for a device that doesn't.
--
-- A tombstone never changes (H-06.3), so a client never deletes an exception: undoing one sets
-- its status to `restored` and the occurrence follows the series again. Exceptions are
-- tombstoned only with their event.

create table public.event_exceptions (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  original_date date not null,
  -- moved: new times (and taking member); skipped: deleted from the series; restored: undone.
  status text not null check (status in ('moved', 'skipped', 'restored')),
  -- A moved timed occurrence's instants, or a moved all-day occurrence's dates.
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  taking_user_id uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (status <> 'moved' and starts_at is null and ends_at is null and start_date is null
      and end_date is null)
    or (status = 'moved' and starts_at is not null and ends_at is not null and ends_at >= starts_at
      and start_date is null and end_date is null)
    or (status = 'moved' and start_date is not null and end_date is not null
      and end_date >= start_date and starts_at is null and ends_at is null)
  )
);

create unique index event_exceptions_event_date_key
  on public.event_exceptions (event_id, original_date);
create index event_exceptions_taking_user_id_idx on public.event_exceptions (taking_user_id);

-- ---------------------------------------------------------------------------
-- An exception belongs to a repeating event of its own household, for life (the generic child
-- check from C-01.1), matches the event's timed or all-day form, keeps its date, and names a
-- taking member from the household.
-- ---------------------------------------------------------------------------
create function private.check_event_exception()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.events;
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then
      return new;
    end if;
    if new.original_date <> old.original_date then
      raise exception 'an exception cannot move to another occurrence' using errcode = '23514';
    end if;
    -- Only the event's own deletion tombstones its exceptions (a cascade from its trigger).
    if new.deleted_at is not null and pg_trigger_depth() = 1 then
      raise exception 'restore the occurrence instead of deleting the exception'
        using errcode = '23514';
    end if;
  end if;
  select * into event from public.events e where e.id = new.event_id;
  if event.repeat is null and new.deleted_at is null then
    raise exception 'the event does not repeat' using errcode = '23514';
  end if;
  if new.status = 'moved' and (new.starts_at is null) <> event.all_day then
    raise exception 'a moved occurrence keeps its event''s timed or all-day form'
      using errcode = '23514';
  end if;
  if new.taking_user_id is not null
    and (tg_op = 'INSERT' or new.taking_user_id is distinct from old.taking_user_id)
    and not exists (
      select 1 from public.household_members m
      where m.household_id = new.household_id and m.user_id = new.taking_user_id
        and m.status = 'active' and m.deleted_at is null
    ) then
    raise exception 'the taking member is not in this household' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_event_exception() from public;

-- Named so the generic check (membership and household first) runs before this one, and both
-- before the sync triggers.
create trigger check_event_child before insert or update on public.event_exceptions
  for each row execute function private.check_event_child();
create trigger check_event_exception before insert or update on public.event_exceptions
  for each row execute function private.check_event_exception();

-- Deleting an event now tombstones its exceptions too.
create or replace function private.delete_event_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_people set deleted_at = now()
  where event_id = new.id and deleted_at is null;
  update public.event_reminders set deleted_at = now()
  where event_id = new.id and deleted_at is null;
  update public.event_exceptions set deleted_at = now()
  where event_id = new.id and deleted_at is null;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: exceptions follow their event, like its people and reminders (architecture section 4).
-- ---------------------------------------------------------------------------
alter table public.event_exceptions enable row level security;
revoke all on public.event_exceptions from anon;

create policy "Members read the exceptions of events they can see"
  on public.event_exceptions for select to authenticated
  using (private.can_read_event(event_id));
create policy "Event editors add exceptions"
  on public.event_exceptions for insert to authenticated
  with check (private.can_edit_event(event_id));
create policy "Event editors change exceptions"
  on public.event_exceptions for update to authenticated
  using (private.can_edit_event(event_id))
  with check (private.can_edit_event(event_id));

select private.enable_sync('public.event_exceptions');

-- Deletion (A-04.3) and export (A-04.2), FR2-PRIV-1 and FR2-PRIV-2.
select private.register_for_deletion('public.event_exceptions', 'household_id', 'household');
select private.register_for_deletion('public.event_exceptions', 'taking_user_id', 'user', 'set_null');
select private.register_for_export('public.event_exceptions', 'household', 'household_id');
