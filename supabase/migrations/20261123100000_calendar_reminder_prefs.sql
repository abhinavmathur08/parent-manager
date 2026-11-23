-- C-04.1 (FR2-REM-2, architecture "Notifications"): the per-type switch for calendar event
-- reminders. The reminders themselves are local notifications scheduled on each device from
-- the synced calendar, so the server only stores the switch for the member's devices to read.
--
-- New columns go on the end of the row, so private.notification_prefs_of() is replaced to
-- fill in the new default for a member who never saved settings.

alter table public.notification_prefs
  add column calendar_reminders boolean not null default true;

create or replace function private.notification_prefs_of(target uuid)
returns public.notification_prefs
language plpgsql
stable
set search_path = ''
as $$
declare
  prefs public.notification_prefs;
begin
  select * into prefs from public.notification_prefs where user_id = target;
  if not found then
    prefs := row(target, true, true, true, true, null, 1080, 1260, 420, now(), now(), true);
  end if;
  return prefs;
end;
$$;

revoke all on function private.notification_prefs_of(uuid) from public;
