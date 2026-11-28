-- T-04.2 (FR3-NOT-3): when another member assigns a task or occurrence, the assignee gets one
-- inbox entry and push with task IDs only, batched to 1 an hour. Assigning yourself, the
-- server's own writes and rotation turns send nothing, and the switch turns it off.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- What `who` has been told, oldest first: each entry's task IDs.
create function tests.told(who uuid) returns setof jsonb language sql security definer as $$
  select payload -> 'task_ids' from public.notifications
  where user_id = who and type = 'task_assigned' order by created_at, id
$$;

-- Household A (Premium): parents P1 and P2, caregiver C. Household B: parent Q. Quiet hours
-- off for everyone, so pushes are due at once.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'p1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'p2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'c@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'q@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'US', 'en-US', 'us_customary', 'America/New_York', 7);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
insert into public.notification_prefs (user_id, quiet_start_minute, quiet_end_minute)
select id, 0, 0 from auth.users;

-- ---------------------------------------------------------------------------
-- Who is told
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, assignee_user_id) values
  ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'Book the 12-month checkup', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
   'Mine', 'aaaaaaaa-0000-0000-0000-000000000001');
reset role;

select results_eq(
  $$select * from tests.told('aaaaaaaa-0000-0000-0000-000000000002')$$,
  $$values ('["aaaaaaaa-7777-0000-0000-000000000001"]'::jsonb)$$,
  'another member assigning a task tells the assignee once');
select is(
  (select payload::text from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '{"task_ids": ["aaaaaaaa-7777-0000-0000-000000000001"]}',
  'the payload is the task IDs only, never the title');
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'assigning yourself sends nothing');

-- "I'll do it": C takes a shared task.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, shared) values
  ('aaaaaaaa-7777-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Shared', true);
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
update public.tasks set assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000003'
where id = 'aaaaaaaa-7777-0000-0000-000000000003';
reset role;
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  0, 'taking a task yourself sends nothing');

-- The server's own writes (no member) tell nobody.
select set_config('request.jwt.claims', '', true);
update public.tasks set assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000003'
where id = 'aaaaaaaa-7777-0000-0000-000000000002';
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  0, 'a server write sends nothing');

-- ---------------------------------------------------------------------------
-- Batching (1 an hour)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, assignee_user_id) values
  ('aaaaaaaa-7777-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a',
   'Second', 'aaaaaaaa-0000-0000-0000-000000000002');
reset role;
select results_eq(
  $$select * from tests.told('aaaaaaaa-0000-0000-0000-000000000002')$$,
  $$values ('["aaaaaaaa-7777-0000-0000-000000000001", "aaaaaaaa-7777-0000-0000-000000000004"]'::jsonb)$$,
  'a second assignment before the push joins the waiting entry');

-- The batch goes out; the next assignment waits until an hour after it.
select is((select count(*)::int from public.claim_pushes()), 1, 'one push for the batch');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, assignee_user_id) values
  ('aaaaaaaa-7777-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a',
   'Third', 'aaaaaaaa-0000-0000-0000-000000000002');
reset role;
select ok(
  (select deliver_at >= now() + interval '59 minutes' from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and pushed_at is null),
  'an assignment within the hour after a push waits for the hour');
select is((select count(*)::int from public.claim_pushes()), 0, 'and isn''t pushed yet');

-- ---------------------------------------------------------------------------
-- Rotations and occurrences
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, due_date, repeat, rotation_user_ids, assignee_user_id) values
  ('aaaaaaaa-7777-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000a', 'Bins',
   '2026-12-01', '{"freq": "weekly"}',
   array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
   'aaaaaaaa-0000-0000-0000-000000000001');
-- The turn passes from P1 to C.
update public.tasks set assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000003'
where id = 'aaaaaaaa-7777-0000-0000-000000000006';
reset role;
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  0, 'a rotation turn sends nothing');

-- P1 hands one occurrence to P2: an explicit reassignment.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.task_occurrences (id, household_id, task_id, original_date, assignee_user_id) values
  ('aaaaaaaa-8888-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-7777-0000-0000-000000000006', '2026-12-08', 'aaaaaaaa-0000-0000-0000-000000000002');
reset role;
select ok(
  (select payload -> 'task_ids' ? 'aaaaaaaa-7777-0000-0000-000000000006' from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and pushed_at is null),
  'reassigning an occurrence tells the new assignee, naming the chore');

-- ---------------------------------------------------------------------------
-- The switch and isolation
-- ---------------------------------------------------------------------------
update public.notification_prefs set task_assigned = false
where user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, shared, assignee_user_id) values
  ('aaaaaaaa-7777-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000a', 'For C', true,
   'aaaaaaaa-0000-0000-0000-000000000003');
reset role;
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  0, 'with the switch off, nothing is queued');

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.notifications where type = 'task_assigned'),
  0, 'another household''s member can''t read the entries');
reset role;

select * from finish();
rollback;
