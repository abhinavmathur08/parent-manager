-- T-04.1 (FR3-NOT-1, FR3-NOT-4, FR3-NOT-5; architecture "Notifications"): the switches for task
-- reminders and today's tasks. Both are local notifications worked out on the device from the
-- synced tasks, so the server only keeps the member's settings, which the device caches for
-- offline use. Neither is a push type, so `notifications.type` is unchanged.

alter table public.notification_prefs
  add column task_reminders boolean not null default true,
  add column tasks_today boolean not null default true;

-- As in 20261123130000, with the two new columns in the default row (it's built positionally).
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
    prefs := row(target, true, true, true, true, null, 1080, 1260, 420, now(), now(), true, true, true,
      true, true, true);
  end if;
  return prefs;
end;
$$;

revoke all on function private.notification_prefs_of(uuid) from public;
