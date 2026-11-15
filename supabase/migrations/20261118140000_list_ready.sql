-- N-02.2 (FR-NOT-4): "list is ready" goes to the household's other members when a member
-- taps it on the List tab, or when their own change plans the week, at most once per list
-- per day (the household's day). The household's weekly list is identified by its week.

create table public.list_ready_events (
  household_id uuid not null references public.households (id) on delete cascade,
  week_start date not null,
  -- The day it was sent, in the household's timezone.
  local_date date not null,
  sent_by uuid references auth.users (id) on delete set null,
  trigger text not null check (trigger in ('button', 'week_planned')),
  created_at timestamptz not null default now(),
  primary key (household_id, week_start, local_date)
);

alter table public.list_ready_events enable row level security;

-- Members see whether the list was announced today, so the button can say so.
create policy "Members can read their household's list-ready events"
  on public.list_ready_events for select to authenticated
  using (private.household_role(household_id) is not null);

-- Written only by announce_list_ready().
revoke insert, update, delete on public.list_ready_events from anon, authenticated;

-- Announces the caller's list for the week starting `week` to the household's other
-- active members. Returns `sent`, or `already_sent` when the list was announced today.
create function public.announce_list_ready(week date, source text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  hid uuid;
  tz text;
  today date;
  inserted boolean;
  member record;
begin
  select m.household_id, h.timezone into hid, tz
  from public.household_members m
  join public.households h on h.id = m.household_id and h.deleted_at is null
  where m.user_id = uid and m.status = 'active' and m.deleted_at is null
  limit 1;
  if hid is null then
    raise exception 'not a member of a household' using errcode = '42501';
  end if;
  if source not in ('button', 'week_planned') then
    raise exception 'unknown trigger' using errcode = '22023';
  end if;
  today := (now() at time zone tz)::date;

  insert into public.list_ready_events (household_id, week_start, local_date, sent_by, trigger)
  values (hid, week, today, uid, source)
  on conflict do nothing
  returning true into inserted;
  if inserted is null then
    return 'already_sent';
  end if;

  for member in
    select m.user_id from public.household_members m
    where m.household_id = hid and m.status = 'active' and m.deleted_at is null
      and m.user_id <> uid
  loop
    perform private.enqueue_notification(
      member.user_id, hid, 'list_ready', jsonb_build_object('week_start', week),
      'list_ready:' || week || ':' || today);
  end loop;
  return 'sent';
end;
$$;

revoke all on function public.announce_list_ready(date, text) from public, anon;
grant execute on function public.announce_list_ready(date, text) to authenticated;

select private.register_for_deletion('public.list_ready_events', 'household_id', 'household');
select private.register_for_deletion('public.list_ready_events', 'sent_by', 'user', 'set_null');
