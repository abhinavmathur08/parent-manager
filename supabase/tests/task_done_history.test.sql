-- T-02.3, FR3-TASK-9, FR3-PAY-2: on Free, done tasks completed before the current week and the 4
-- before it (app_config tasks.limits.done_history_weeks) aren't returned and can't be reopened;
-- open tasks always are; Premium sees all; nothing is deleted.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

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
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent');

-- An open task, a recent completion and an old one.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, done) values
  ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Old but open', false),
  ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Done this week', true),
  ('aaaaaaaa-7777-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Done long ago', true);
-- The server stamps done_at with now; move the old completion back past the window.
reset role;
alter table public.tasks disable trigger user;
update public.tasks set done_at = now() - interval '60 days'
where id = 'aaaaaaaa-7777-0000-0000-000000000003';
alter table public.tasks enable trigger user;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select results_eq(
  $$select title from public.tasks order by title$$,
  array['Done this week', 'Old but open'],
  'on Free, a done task older than the window isn''t returned (FR3-TASK-9)');
select is(
  public.visible_ids('tasks', '00000000-0000-0000-0000-00000000000a') @> array['aaaaaaaa-7777-0000-0000-000000000003'::uuid],
  false, 'and scoped sync drops it from devices');
select is_empty(
  $$update public.tasks set done = false where id = 'aaaaaaaa-7777-0000-0000-000000000003' returning id$$,
  'and it can''t be reopened');

-- A window of 9 weeks brings it back.
reset role;
update public.app_config set value = jsonb_set(value, '{done_history_weeks}', '9') where key = 'tasks.limits';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.tasks), 3, 'the window is a server setting (R3-PAY-1)');
reset role;
update public.app_config set value = jsonb_set(value, '{done_history_weeks}', '4') where key = 'tasks.limits';

reset role;
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.tasks), 3, 'Premium sees all done tasks');
select lives_ok(
  $$update public.tasks set done = false where id = 'aaaaaaaa-7777-0000-0000-000000000003'$$,
  'and can reopen an old one');

reset role;
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select count(*)::int from public.tasks where household_id = '00000000-0000-0000-0000-00000000000a'),
  3, 'nothing is deleted on a lapse');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.tasks), 3,
  'a reopened task is open, so it shows on Free again');

select * from finish();
rollback;
