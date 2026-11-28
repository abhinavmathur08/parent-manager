-- T-01.2, R3-ACC-1, R3-ACC-3, NFR3-SEC-1, D-25: family members and caregivers see only tasks
-- assigned to them, shared, or in their rotation, and only while the household has Premium; what
-- they add is always shared and never a chore; they never change `shared`, assign another helper
-- or edit tasks they didn't create beyond completing, taking or handing back; they skip or
-- reassign only their own occurrences. Parents assign to a helper only on Premium.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Household A: parents P1 and P2, family member F, caregivers C and D. Premium.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'p1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'p2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'f@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'c@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'd@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000005', 'caregiver');
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

-- A parent's tasks: private, shared, assigned to C, a chore rotating P1 and C, and assigned to D.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, shared, assignee_user_id, due_date, repeat, rotation_user_ids) values
  ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Private', false, null, null, null, null),
  ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Shared', true, null, null, null, null),
  ('aaaaaaaa-7777-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'For C', false, 'aaaaaaaa-0000-0000-0000-000000000004', null, null, null),
  ('aaaaaaaa-7777-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', 'Bath', false, null, '2026-12-01',
   '{"freq": "daily"}', array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004']::uuid[]),
  ('aaaaaaaa-7777-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', 'For D', false, 'aaaaaaaa-0000-0000-0000-000000000005', null, null, null);

-- ---------------------------------------------------------------------------
-- What a caregiver sees (R3-ACC-1)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select results_eq(
  $$select title from public.tasks order by title$$,
  array['Bath', 'For C', 'Shared'],
  'a caregiver sees tasks assigned to them, shared tasks and their rotations');
select is_empty(
  $$update public.tasks set done = true where id = 'aaaaaaaa-7777-0000-0000-000000000001' returning id$$,
  'and can''t complete a private task');
select is(
  public.visible_ids('tasks', '00000000-0000-0000-0000-00000000000a') @> array['aaaaaaaa-7777-0000-0000-000000000001'::uuid],
  false, 'scoped sync leaves the private task out');

-- ---------------------------------------------------------------------------
-- What a caregiver writes (T3 to T8)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.tasks (id, household_id, title, shared, assignee_user_id) values
    ('aaaaaaaa-7777-0000-0000-000000000011', '00000000-0000-0000-0000-00000000000a',
     'Out of nappy cream', true, 'aaaaaaaa-0000-0000-0000-000000000002')$$,
  'a caregiver adds a shared task assigned to a parent');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, shared) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Hidden', false)$$,
  '42501', null, 'a caregiver''s task is always shared');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, shared, assignee_user_id) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'For D', true, 'aaaaaaaa-0000-0000-0000-000000000005')$$,
  '42501', 'a helper assigns only to themself or a parent', 'a caregiver can''t assign another helper');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, shared, due_date, repeat) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Chore', true, '2026-12-01', '{"freq": "daily"}')$$,
  '42501', 'only a parent can set a repeat or a rotation', 'a caregiver can''t create a chore');
select lives_ok(
  $$update public.tasks set title = 'Out of nappy cream (the blue one)'
    where id = 'aaaaaaaa-7777-0000-0000-000000000011'$$,
  'a caregiver edits a task they created');
select throws_ok(
  $$update public.tasks set shared = false where id = 'aaaaaaaa-7777-0000-0000-000000000011'$$,
  '42501', 'only a parent can share or unshare a task', 'but can''t unshare it');
select throws_ok(
  $$update public.tasks set title = 'Renamed' where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', 'only the task''s creator or a parent can change it', 'a caregiver can''t edit a parent''s task');
select throws_ok(
  $$update public.tasks set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', 'only the task''s creator or a parent can change it', 'or delete it');
select lives_ok(
  $$update public.tasks set done = true where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  'a caregiver completes a shared task (T6)');
select lives_ok(
  $$update public.tasks set done = false where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  'and reopens it');
select lives_ok(
  $$update public.tasks set assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000004'
    where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  'and takes it ("I''ll do it")');
select throws_ok(
  $$update public.tasks set assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000005'
    where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  '42501', 'a helper assigns only to themself or a parent', 'but can''t hand it to another helper');
select lives_ok(
  $$update public.tasks set assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  'a caregiver hands back a shared task they took, to a parent');
select throws_ok(
  $$update public.tasks set assignee_user_id = null where id = 'aaaaaaaa-7777-0000-0000-000000000003'$$,
  '42501', 'a helper hands back only a shared task', 'but not a private one assigned to them');
select throws_ok(
  $$update public.tasks set rotation_user_ids = array['aaaaaaaa-0000-0000-0000-000000000004',
      'aaaaaaaa-0000-0000-0000-000000000002']::uuid[]
    where id = 'aaaaaaaa-7777-0000-0000-000000000004'$$,
  '42501', null, 'a caregiver can''t change a rotation');

-- ---------------------------------------------------------------------------
-- Occurrences (T10)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.task_occurrences (id, household_id, task_id, original_date, assignee_user_id, done) values
    ('aaaaaaaa-9999-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000004', '2026-12-01', 'aaaaaaaa-0000-0000-0000-000000000001', true)$$,
  'a caregiver completes a rotation occurrence that was a parent''s turn');
select throws_ok(
  $$update public.task_occurrences set skipped = true where id = 'aaaaaaaa-9999-0000-0000-000000000001'$$,
  '42501', 'a helper skips or reassigns only their own occurrence', 'but can''t skip it');
select lives_ok(
  $$insert into public.task_occurrences (id, household_id, task_id, original_date, assignee_user_id, skipped) values
    ('aaaaaaaa-9999-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000004', '2026-12-02', 'aaaaaaaa-0000-0000-0000-000000000004', true)$$,
  'a caregiver skips their own turn');
select lives_ok(
  $$update public.task_occurrences set skipped = false, assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000002'
    where id = 'aaaaaaaa-9999-0000-0000-000000000002'$$,
  'and reassigns it to a parent');
select throws_ok(
  $$insert into public.task_occurrences (id, household_id, task_id, original_date, done) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', '2026-12-02', true)$$,
  '42501', null, 'a caregiver can''t touch occurrences of tasks they can''t see');

-- ---------------------------------------------------------------------------
-- A family member has the same rules, and sees D's task no more than C did
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select results_eq(
  $$select title from public.tasks order by title$$,
  array['Out of nappy cream (the blue one)', 'Shared'],
  'a family member sees shared tasks only');

-- ---------------------------------------------------------------------------
-- Parents (T5) and a lapse (R3-ACC-3)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.tasks), 6, 'a parent sees every task, including a helper''s');
select lives_ok(
  $$update public.tasks set shared = false where id = 'aaaaaaaa-7777-0000-0000-000000000011'$$,
  'a parent can unshare a helper''s task');
reset role;
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$update public.tasks set assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000004'
    where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
  '23514', 'assigning to a helper needs Premium', 'on Free, a parent can''t assign a helper');
select lives_ok(
  $$update public.tasks set assignee_user_id = 'aaaaaaaa-0000-0000-0000-000000000002'
    where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
  'but assigns the other parent');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select is_empty($$select id from public.tasks$$, 'after a lapse a caregiver sees no task');
select is_empty($$select id from public.task_occurrences$$, 'and no occurrence');

select * from finish();
rollback;
