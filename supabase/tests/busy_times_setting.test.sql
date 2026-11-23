-- C-05.3, R2-PAY-1: the busy-times window and refresh limit are a server setting that
-- signed-in members can read.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

select is(
  (select value from public.app_config where key = 'calendar.busy_times'),
  '{"window_days": 14, "refresh_minutes": 15}'::jsonb,
  'busy times read 14 days ahead and refresh at most every 15 minutes (PROPOSED)');

insert into auth.users (id, email, aud, role) values
  ('cccccccc-0000-0000-0000-000000000001', 'reader@example.test', 'authenticated', 'authenticated');
select set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true);
set local role authenticated;
select isnt_empty(
  $$select value from public.app_config where key = 'calendar.busy_times'$$,
  'a signed-in member reads the setting');

select * from finish();
rollback;
