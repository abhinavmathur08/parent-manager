-- T-04.1 (FR3-NOT-5): task reminders and today's tasks are on by default, members change only
-- their own, and another member can't read or write them.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a1@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b1@example.test', 'authenticated', 'authenticated');

select is(
  (select row(p.task_reminders, p.tasks_today, p.document_expiry, p.quiet_end_minute)::text
   from private.notification_prefs_of('aaaaaaaa-0000-0000-0000-000000000001') p),
  '(t,t,t,420)',
  'with no row, task reminders and today''s tasks are on, and the other defaults are kept');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.notification_prefs (user_id, task_reminders, tasks_today)
values ('aaaaaaaa-0000-0000-0000-000000000001', false, true);
reset role;

select is(
  (select row(p.task_reminders, p.tasks_today)::text
   from private.notification_prefs_of('aaaaaaaa-0000-0000-0000-000000000001') p),
  '(f,t)',
  'a member turns task reminders off for themselves');

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.notification_prefs
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'another member can''t read them');

update public.notification_prefs set tasks_today = false
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select throws_ok(
  $$insert into public.notification_prefs (user_id, task_reminders)
    values ('aaaaaaaa-0000-0000-0000-000000000001', true)$$,
  '42501', null,
  'another member can''t write them');
reset role;

select is(
  (select row(p.task_reminders, p.tasks_today)::text
   from public.notification_prefs p where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '(f,t)',
  'another member''s update changes nothing');

select col_not_null('public', 'notification_prefs', 'tasks_today', 'tasks_today is never null');

select * from finish();
rollback;
