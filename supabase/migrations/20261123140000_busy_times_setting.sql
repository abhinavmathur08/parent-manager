-- C-05.3: the busy-times window and refresh limit as a server setting (FR2-DEV-4, FR2-DEV-5,
-- R2-PAY-1). A member's device reads its chosen calendars for the next `window_days` days and
-- refreshes their busy blocks at most every `refresh_minutes` minutes (PROPOSED numbers).
-- The device falls back to these values when offline or when the row is missing.
insert into public.app_config (key, value) values (
  'calendar.busy_times',
  jsonb_build_object('window_days', 14, 'refresh_minutes', 15)
)
on conflict (key) do nothing;
