-- T-01.1, FR3-TASK-3, FR3-PAY-2, R3-TASK-1 to R3-TASK-3, R3-CHORE-1, R3-CHORE-2, R3-LINK-1,
-- NFR3-SEC-1, D-24: tasks and task_occurrences are isolated per household; parents read and write
-- every task; the server stamps the writer and the completion, and a stale reopen can't undo it;
-- a free household gets up to `tasks.limits.free_chores` recurring chores (default 3, may be 0)
-- and no rotation; occurrences belong to a chore of their own household and are tombstoned with
-- it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the test)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Every read and write a member of household A might try against household B.
create function tests.cannot_reach_household_b(label text)
returns setof text language plpgsql as $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  b_task constant uuid := 'bbbbbbbb-7777-0000-0000-000000000001';
begin
  return next is_empty(
    format('select id from public.tasks where household_id = %L', b),
    label || ': cannot read household B''s tasks');
  return next is_empty(
    format('select id from public.task_occurrences where household_id = %L', b),
    label || ': cannot read household B''s occurrences');
  return next is_empty(
    format('update public.tasks set title = %L where household_id = %L returning id', 'Hacked', b),
    label || ': cannot edit household B''s tasks');
  return next is_empty(
    format('update public.task_occurrences set done = true where household_id = %L returning id', b),
    label || ': cannot edit household B''s occurrences');
  return next throws_ok(
    format($q$insert into public.tasks (id, household_id, title) values (gen_random_uuid(), %L, 'Intruder')$q$, b),
    '42501', null, label || ': cannot add a task to household B');
  return next throws_ok(
    format($q$insert into public.task_occurrences (id, household_id, task_id, original_date, done)
      values (gen_random_uuid(), %L, %L, '2026-12-01', true)$q$, b, b_task),
    '42501', null, label || ': cannot complete household B''s chore');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (Free: two parents, a caregiver kept for T-01.2), household B (Free).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-partner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

-- Household B's chore, written by its parent.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.tasks (id, household_id, title, due_date, repeat) values
  ('bbbbbbbb-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Bins',
   '2026-12-01', '{"freq": "weekly", "weekdays": [2]}');
insert into public.task_occurrences (id, household_id, task_id, original_date, done) values
  ('bbbbbbbb-9999-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b',
   'bbbbbbbb-7777-0000-0000-000000000001', '2026-12-01', true);

-- ---------------------------------------------------------------------------
-- Structure (R3-TASK-1, R3-TASK-3): no person tag, priority, health field or attachment; the
-- only free text is the title and notes.
-- ---------------------------------------------------------------------------
reset role;
select columns_are('public', 'tasks', array[
  'id', 'household_id', 'title', 'template_item_id', 'notes', 'due_date', 'due_at',
  'assignee_user_id', 'shared', 'reminder', 'repeat', 'after_done_days', 'rotation_user_ids',
  'source_kind', 'source_id', 'done', 'done_at', 'done_by', 'created_by', 'updated_by', 'version',
  'created_at', 'updated_at', 'deleted_at'
], 'tasks have only the columns the spec allows (R3-TASK-3)');
select col_type_is('public', 'tasks', 'due_date', 'date', 'a due date alone is a date (FR3-TASK-3)');
select col_type_is('public', 'tasks', 'due_at', 'timestamp with time zone', 'a due time is an instant');
select has_trigger('public', 'tasks', 'sync_before_update', 'tasks sync');
select has_trigger('public', 'task_occurrences', 'sync_before_update', 'occurrences sync');
select is(
  (select value -> 'free_chores' from public.app_config where key = 'tasks.limits'),
  '3'::jsonb, 'the free chore cap defaults to 3 (D-24)');

-- ---------------------------------------------------------------------------
-- A parent adds and edits tasks (FR3-TASK-2, FR3-TASK-3)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.tasks (id, household_id, title, due_date, assignee_user_id, created_by) values
    ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
     'Book the car service', '2026-12-04', 'aaaaaaaa-0000-0000-0000-000000000002',
     'aaaaaaaa-0000-0000-0000-000000000002')$$,
  'a parent adds a task assigned to the other parent');
select is(
  (select created_by from public.tasks where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the server records who created it, not the client');
select lives_ok(
  $$insert into public.tasks (id, household_id, template_item_id, due_at, reminder, source_kind, source_id) values
    ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
     'checklist_item.newborn.add_baby_to_insurance', '2026-12-05 23:00+00', 'reminder.at_time',
     'source.checklist', gen_random_uuid())$$,
  'an unedited checklist item has no title, and a source is a link (R3-TASK-2, R3-LINK-1)');
select throws_ok(
  $$insert into public.tasks (id, household_id) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a')$$,
  '23514', null, 'a task needs a title or a template item');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, due_date, due_at) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Both', '2026-12-04', now())$$,
  '23514', null, 'a task has a due date or a due time, not both (R3-TASK-1)');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, due_date, reminder) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'No time', '2026-12-04', 'reminder.at_time')$$,
  '23514', null, 'an "at the time" reminder needs a due time');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, assignee_user_id) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Outsider', 'bbbbbbbb-0000-0000-0000-000000000001')$$,
  '23514', 'the assignee is not in this household', 'the assignee must be in the household');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, source_kind) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Half a link', 'source.event')$$,
  '23514', null, 'a source has a kind and an ID together');

-- ---------------------------------------------------------------------------
-- Completion is a check column (R3-TASK-1, NFR3-OFF-2)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
update public.tasks set done = true, version = 1 where id = 'aaaaaaaa-7777-0000-0000-000000000001';
select is(
  (select done_by from public.tasks where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'the server records who completed it');
select isnt(
  (select done_at from public.tasks where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  null, 'and when');
select is(
  (select updated_by from public.tasks where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'and who last changed it');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
-- Based on version 1, from a device that hadn't seen the completion.
update public.tasks set done = false, version = 1 where id = 'aaaaaaaa-7777-0000-0000-000000000001';
select is(
  (select done from public.tasks where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  true, 'a stale reopen doesn''t undo a completion');
update public.tasks set done = false, version = 3 where id = 'aaaaaaaa-7777-0000-0000-000000000001';
select is(
  (select done from public.tasks where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  false, 'a reopen based on the completion does');
select is(
  (select created_by from public.tasks where id = 'aaaaaaaa-7777-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the creator never changes');

-- ---------------------------------------------------------------------------
-- The free chore cap (FR3-CHORE-7, FR3-PAY-2, D-24)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.tasks (id, household_id, title, due_date, repeat, after_done_days) values
    ('aaaaaaaa-7777-0000-0000-000000000011', '00000000-0000-0000-0000-00000000000a', 'Bins', '2026-12-01', '{"freq": "weekly", "weekdays": [2]}', null),
    ('aaaaaaaa-7777-0000-0000-000000000012', '00000000-0000-0000-0000-00000000000a', 'Kettle', '2026-12-01', null, 30),
    ('aaaaaaaa-7777-0000-0000-000000000013', '00000000-0000-0000-0000-00000000000a', 'Sheets', '2026-12-01', '{"freq": "daily"}', null)$$,
  'a free household sets up 3 recurring chores');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, due_date, repeat) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Fourth', '2026-12-01', '{"freq": "daily"}')$$,
  '23514', 'the household has the most recurring chores allowed on Free',
  'the server refuses a 4th chore on Free');
select throws_ok(
  $$update public.tasks set repeat = '{"freq": "monthly"}', due_date = '2026-12-04'
    where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
  '23514', 'the household has the most recurring chores allowed on Free',
  'and refuses turning a 4th task into a chore');
select lives_ok(
  $$update public.tasks set repeat = '{"freq": "weekly", "weekdays": [3]}'
    where id = 'aaaaaaaa-7777-0000-0000-000000000011'$$,
  'editing an existing chore''s rule is allowed');
select throws_ok(
  $$update public.tasks set rotation_user_ids = array['aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000002']::uuid[]
    where id = 'aaaaaaaa-7777-0000-0000-000000000011'$$,
  '23514', 'rotation needs Premium', 'the server refuses a rotation on Free');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, repeat) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'No start', '{"freq": "daily"}')$$,
  '23514', null, 'a chore needs a first due date');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, due_date, repeat) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Bad rule', '2026-12-01', '{"freq": "hourly"}')$$,
  '23514', null, 'a chore''s rule is the calendar''s rule (R3-CHORE-1)');

-- Deleting a chore frees its place.
update public.tasks set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000013';
select lives_ok(
  $$insert into public.tasks (id, household_id, title, due_date, after_done_days) values
    ('aaaaaaaa-7777-0000-0000-000000000014', '00000000-0000-0000-0000-00000000000a', 'Descale', '2026-12-01', 30)$$,
  'a deleted chore frees its place');

-- The cap is a server setting, and can be 0.
reset role;
update public.app_config set value = jsonb_set(value, '{free_chores}', '0') where key = 'tasks.limits';
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into public.tasks (id, household_id, title, due_date, repeat) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'Second', '2026-12-01', '{"freq": "daily"}')$$,
  '23514', 'the household has the most recurring chores allowed on Free',
  'with the cap at 0, even a household''s first new chore is refused');
reset role;
update public.app_config set value = jsonb_set(value, '{free_chores}', '3') where key = 'tasks.limits';

-- Premium: unlimited chores and rotation.
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.tasks (id, household_id, title, due_date, repeat, rotation_user_ids) values
    ('aaaaaaaa-7777-0000-0000-000000000015', '00000000-0000-0000-0000-00000000000a', 'Bath time', '2026-12-01',
     '{"freq": "daily"}', array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[])$$,
  'Premium allows a 4th chore with a rotation');
select throws_ok(
  $$update public.tasks set rotation_user_ids = array['aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001']::uuid[]
    where id = 'aaaaaaaa-7777-0000-0000-000000000015'$$,
  '23514', 'a member appears twice in the rotation', 'a rotation names each member once');
select throws_ok(
  $$update public.tasks set rotation_user_ids = array['aaaaaaaa-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000001']::uuid[]
    where id = 'aaaaaaaa-7777-0000-0000-000000000015'$$,
  '23514', 'a rotation member is not in this household', 'a rotation names only household members');

-- A lapse keeps every chore, and lets the rotation be cleared (FR3-CHORE-6).
reset role;
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$update public.tasks set rotation_user_ids = null where id = 'aaaaaaaa-7777-0000-0000-000000000015'$$,
  'a lapsed household can clear a rotation');
select is(
  (select count(*)::int from public.tasks where household_id = '00000000-0000-0000-0000-00000000000a'
     and deleted_at is null and (repeat is not null or after_done_days is not null)),
  4, 'and keeps every chore, past the cap');

-- ---------------------------------------------------------------------------
-- Occurrences (R3-CHORE-1, R3-CHORE-2)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.task_occurrences (id, household_id, task_id, original_date, done) values
    ('aaaaaaaa-9999-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000011', '2026-12-02', true)$$,
  'a parent completes an occurrence');
select is(
  (select done_by from public.task_occurrences where id = 'aaaaaaaa-9999-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the server records who completed the occurrence');
select throws_ok(
  $$insert into public.task_occurrences (id, household_id, task_id, original_date, skipped) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000011', '2026-12-02', true)$$,
  '23505', null, 'an occurrence is stored once (R3-CHORE-2)');
select throws_ok(
  $$insert into public.task_occurrences (id, household_id, task_id, original_date, done) values
    (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000002', '2026-12-02', true)$$,
  '23514', 'the task does not repeat', 'only a chore has occurrences');
select throws_ok(
  $$update public.task_occurrences set original_date = '2026-12-09'
    where id = 'aaaaaaaa-9999-0000-0000-000000000001'$$,
  '23514', 'an occurrence cannot move to another chore or date', 'an occurrence keeps its date');
select throws_ok(
  $$update public.task_occurrences set deleted_at = now() where id = 'aaaaaaaa-9999-0000-0000-000000000001'$$,
  '23514', 'reopen or unskip the occurrence instead of deleting it', 'a client never deletes an occurrence');

update public.tasks set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000011';
select isnt(
  (select deleted_at from public.task_occurrences where id = 'aaaaaaaa-9999-0000-0000-000000000001'),
  null, 'deleting a chore tombstones its occurrences');

-- ---------------------------------------------------------------------------
-- Isolation (NFR3-SEC-1)
-- ---------------------------------------------------------------------------
select tests.cannot_reach_household_b('A parent');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty(
  $$select id from public.tasks where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'a caregiver on a free household reads no tasks');

select * from finish();
rollback;
