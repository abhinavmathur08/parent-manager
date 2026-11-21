-- C-01.1: calendar events, the people they're for and their reminders, with RLS and household
-- sync (architecture sections 3.5, 4 and 5; spec FR2-CAL-3, FR2-CAL-6, FR2-REM-1, FR2-PAY-2,
-- R2-CAL-1, NFR2-SEC-1; decisions D-15 and D-16).
--
-- All three tables are synced (private.enable_sync, D-13): IDs are made on the device, the
-- server sets created_at, updated_at and version, and deletes are soft.
--
-- Who sees what (spec section 2, D-16): parents see every event. Family members and caregivers
-- see only shared events, and only while the household has Premium (private.household_role is
-- already null for them on Free). The child tables follow their event.
--
-- Who writes what (spec section 2, rows C3 to C6):
--   - Parents create, edit, delete, share and unshare any event.
--   - Family members and caregivers create shared events only, edit and delete the ones they
--     created, and set "taking" to themselves on any shared event. They never change `shared`.
--
-- Repeats are stored as a rule and expanded on the device (R2-CAL-1); C-01.2 adds exceptions
-- and validates the rule.

-- ---------------------------------------------------------------------------
-- Settings: the reminders allowed per event (FR2-REM-1, D-15), tuned without a release
-- (R2-PAY-1).
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values (
  'calendar.reminders',
  jsonb_build_object('free', 1, 'premium', 5)
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- A fixed identifier; names come from translations (NFR2-L10N-1).
  kind text not null default 'kind.appointment' check (
    kind in ('kind.appointment', 'kind.childcare', 'kind.activity', 'kind.family', 'kind.other')
  ),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- A timed event is two instants. An all-day event is two dates (inclusive) in the
  -- household's timezone, so a timezone change never moves it (FR2-CAL-3, R2-CAL-1).
  all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  -- Free text, never geocoded (FR2-CAL-2).
  place text check (char_length(btrim(place)) between 1 and 200),
  notes text check (char_length(notes) <= 4000),
  -- The member taking the child or person, or nobody yet.
  taking_user_id uuid references auth.users (id) on delete set null,
  -- Visible to family members and caregivers (D-16). Only parents change it.
  shared boolean not null default false,
  -- The repeat rule, or null for a single event (FR2-CAL-4). Validated in C-01.2.
  repeat jsonb check (repeat is null or jsonb_typeof(repeat) = 'object'),
  -- Set by the server, never the client.
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (all_day and start_date is not null and end_date is not null and end_date >= start_date
      and starts_at is null and ends_at is null)
    or (not all_day and starts_at is not null and ends_at is not null and ends_at >= starts_at
      and start_date is null and end_date is null)
  )
);

-- Who the event is for (FR2-CAL-2): people from household_people.
create table public.event_people (
  id uuid primary key,
  -- A copy of the event's household, so policies need no join (architecture section 4).
  household_id uuid not null references public.households (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  person_id uuid not null references public.household_people (id) on delete cascade,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Reminders before an event (FR2-REM-1): at the time, 15 minutes, 1 hour, 1 day or 2 days.
create table public.event_reminders (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  offset_minutes integer not null check (offset_minutes in (0, 15, 60, 1440, 2880)),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One live row per person and per offset. Tombstones stay, so a person removed from an event
-- and added again gets a new row.
create unique index event_people_event_person_key
  on public.event_people (event_id, person_id) where deleted_at is null;
create unique index event_reminders_event_offset_key
  on public.event_reminders (event_id, offset_minutes) where deleted_at is null;
create index events_household_starts_at_idx on public.events (household_id, starts_at);
create index events_household_start_date_idx on public.events (household_id, start_date);
create index events_taking_user_id_idx on public.events (taking_user_id);
create index events_created_by_idx on public.events (created_by);
create index events_updated_by_idx on public.events (updated_by);
create index event_people_person_id_idx on public.event_people (person_id);
create index event_reminders_event_id_idx on public.event_reminders (event_id);

-- ---------------------------------------------------------------------------
-- Visibility helpers (architecture section 4). Tombstones count, so a deletion syncs.
-- ---------------------------------------------------------------------------
create function private.can_read_event(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = target
      and (private.household_role(e.household_id) = 'parent'
        or (e.shared and private.household_role(e.household_id) is not null))
  )
$$;

-- Whether the caller may change an event's people and reminders: a parent, or the family
-- member or caregiver who created it, while it's shared (spec section 2, C4 and C5).
create function private.can_edit_event(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = target
      and (private.household_role(e.household_id) = 'parent'
        or (e.shared and e.created_by = (select auth.uid())
          and private.household_role(e.household_id) is not null))
  )
$$;

revoke all on function private.can_read_event(uuid) from public;
revoke all on function private.can_edit_event(uuid) from public;
grant execute on function private.can_read_event(uuid) to authenticated;
grant execute on function private.can_edit_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Events: stamp the writer, keep the role rules RLS can't express, and keep the taking member
-- inside the household. Named to run before the sync triggers.
-- ---------------------------------------------------------------------------
create function private.check_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller constant uuid := (select auth.uid());
  role text;
  -- Columns a family member or caregiver may change on a shared event they didn't create
  -- (C6), plus the ones the server sets.
  free_columns constant text[] :=
    array['taking_user_id', 'updated_by', 'version', 'created_at', 'updated_at'];
begin
  -- Account erasure clears user columns (section 3.4); the row is left as erasure sets it.
  if private.is_erasing() then
    return new;
  end if;
  -- A tombstone never changes; the sync trigger answers a late edit with it.
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;

  role := private.household_role(new.household_id);
  -- Refuse non-members before reading anything else, so errors never leak another household.
  if role is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := caller;
  else
    new.created_by := old.created_by;
    if role <> 'parent' then
      if new.shared is distinct from old.shared then
        raise exception 'only a parent can share or unshare an event' using errcode = '42501';
      end if;
      if old.created_by is distinct from caller then
        if (to_jsonb(new) - free_columns) is distinct from (to_jsonb(old) - free_columns)
          or (new.taking_user_id is distinct from old.taking_user_id
            and new.taking_user_id is distinct from caller
            and not (old.taking_user_id = caller and new.taking_user_id is null)) then
          raise exception 'only the event''s creator or a parent can change it'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
  new.updated_by := caller;

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

create trigger check_event before insert or update on public.events
  for each row execute function private.check_event();

-- ---------------------------------------------------------------------------
-- People and reminders belong to an event of their own household, for life. One added offline
-- to an event deleted meanwhile arrives deleted too.
-- ---------------------------------------------------------------------------
create function private.check_event_child()
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
  -- Refuse non-members first. A cascade from another trigger (an event or person deleted) is
  -- the server's own write and skips this.
  -- An event the caller can't see is refused the same way, so a wrong ID never tells them that
  -- another household's event exists.
  if pg_trigger_depth() = 1 and (private.household_role(new.household_id) is null
    or not private.can_read_event(new.event_id)) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then
    raise exception 'a row cannot move to another event' using errcode = '23514';
  end if;
  select * into event from public.events e where e.id = new.event_id;
  if event.id is null or event.household_id <> new.household_id then
    raise exception 'household_id does not match the event''s household' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and event.deleted_at is not null then
    new.deleted_at := now();
  end if;
  return new;
end;
$$;

create function private.check_event_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.person_id <> old.person_id then
    raise exception 'a row cannot move to another person' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.household_people p
    where p.id = new.person_id and p.household_id = new.household_id
      and (p.deleted_at is null or new.deleted_at is not null)
  ) then
    raise exception 'the person is not in this household' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- FR2-REM-1, D-15: 1 reminder per event on Free, 5 on Premium, from app_config. Only new
-- reminders are counted, so a lapse keeps the ones already set (FR2-REM-6).
create function private.calendar_reminder_limit(target uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (c.value ->> case when private.household_is_premium(target) then 'premium' else 'free' end)::integer
     from public.app_config c where c.key = 'calendar.reminders'),
    1)
$$;

create function private.limit_event_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('event_reminders:' || new.event_id::text, 0));
  if (select count(*) from public.event_reminders r
      where r.event_id = new.event_id and r.deleted_at is null)
    >= private.calendar_reminder_limit(new.household_id) then
    -- A constraint error, so the device's queue refuses the write at once (architecture
    -- section 5) and the app shows the Premium sheet (trigger `reminders`, FR2-PAY-1).
    raise exception 'the event has the most reminders allowed' using errcode = '23514',
      hint = 'calendar.reminders_limit';
  end if;
  return new;
end;
$$;

create trigger check_event_child before insert or update on public.event_people
  for each row execute function private.check_event_child();
create trigger check_event_person before insert or update on public.event_people
  for each row execute function private.check_event_person();
create trigger check_event_child before insert or update on public.event_reminders
  for each row execute function private.check_event_child();
create trigger limit_event_reminders before insert on public.event_reminders
  for each row execute function private.limit_event_reminders();

-- Deleting an event deletes its people and reminders, as tombstones that sync.
create function private.delete_event_children()
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
  return null;
end;
$$;

create trigger delete_event_children after update on public.events
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.delete_event_children();

-- A person removed from the household leaves every event's "for"; the events stay (spec 3.1,
-- edge cases).
create function private.remove_person_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_people set deleted_at = now()
  where person_id = new.id and deleted_at is null;
  return null;
end;
$$;

create trigger remove_person_events
  after update of deleted_at on public.household_people
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.remove_person_events();

revoke all on function private.check_event() from public;
revoke all on function private.check_event_child() from public;
revoke all on function private.check_event_person() from public;
revoke all on function private.calendar_reminder_limit(uuid) from public;
revoke all on function private.limit_event_reminders() from public;
revoke all on function private.delete_event_children() from public;
revoke all on function private.remove_person_events() from public;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.event_people enable row level security;
alter table public.event_reminders enable row level security;
revoke all on public.events, public.event_people, public.event_reminders from anon;

create policy "Parents read every event; others read shared events"
  on public.events for select to authenticated
  using (
    private.household_role(household_id) = 'parent'
    or (shared and private.household_role(household_id) is not null)
  );
create policy "Parents add any event; others add shared events"
  on public.events for insert to authenticated
  with check (
    private.household_role(household_id) = 'parent'
    or (shared and private.household_role(household_id) is not null)
  );
-- Finer rules (own events, "taking", `shared`) are in private.check_event.
create policy "Parents edit any event; others edit shared events"
  on public.events for update to authenticated
  using (
    private.household_role(household_id) = 'parent'
    or (shared and private.household_role(household_id) is not null)
  )
  with check (
    private.household_role(household_id) = 'parent'
    or (shared and private.household_role(household_id) is not null)
  );

create policy "Members read the people of events they can see"
  on public.event_people for select to authenticated
  using (private.can_read_event(event_id));
create policy "Event editors add people"
  on public.event_people for insert to authenticated
  with check (private.can_edit_event(event_id));
create policy "Event editors change people"
  on public.event_people for update to authenticated
  using (private.can_edit_event(event_id))
  with check (private.can_edit_event(event_id));

create policy "Members read the reminders of events they can see"
  on public.event_reminders for select to authenticated
  using (private.can_read_event(event_id));
create policy "Event editors add reminders"
  on public.event_reminders for insert to authenticated
  with check (private.can_edit_event(event_id));
create policy "Event editors change reminders"
  on public.event_reminders for update to authenticated
  using (private.can_edit_event(event_id))
  with check (private.can_edit_event(event_id));

-- Server timestamps and versions, tombstones, no hard deletes, the pull index and Realtime.
select private.enable_sync('public.events');
select private.enable_sync('public.event_people');
select private.enable_sync('public.event_reminders');

-- ---------------------------------------------------------------------------
-- Deletion (A-04.3) and export (A-04.2), FR2-PRIV-1 and FR2-PRIV-2
-- ---------------------------------------------------------------------------
select private.register_for_deletion('public.events', 'household_id', 'household');
select private.register_for_deletion('public.events', 'created_by', 'user', 'set_null');
select private.register_for_deletion('public.events', 'updated_by', 'user', 'set_null');
select private.register_for_deletion('public.events', 'taking_user_id', 'user', 'set_null');
select private.register_for_deletion('public.event_people', 'household_id', 'household');
select private.register_for_deletion('public.event_reminders', 'household_id', 'household');

select private.register_for_export('public.events', 'household', 'household_id');
select private.register_for_export('public.event_people', 'household', 'household_id');
select private.register_for_export('public.event_reminders', 'household', 'household_id');
