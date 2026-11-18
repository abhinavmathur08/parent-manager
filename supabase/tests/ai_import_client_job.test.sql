-- R-06.1, S-20, FR-AI-11: the app names its import job so it can read the result after
-- leaving the screen. IDs can't be reused, only the service role starts jobs, and a job
-- stays readable only by its importer.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, aud, role) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'cj-a@example.test', 'authenticated', 'authenticated'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'cj-b@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-0000000000a1', 'Client job A', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1),
  ('00000000-0000-0000-0000-0000000000b1', 'Client job B', 'US', 'en-US', 'us_customary', 'America/New_York', 7);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1a1a1a1-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-0000000000b1', 'b1b1b1b1-0000-0000-0000-000000000001', 'parent');

select ok(not has_function_privilege('authenticated', 'public.ai_import_start(uuid, text, uuid)', 'execute'),
  'members cannot start jobs themselves');
select ok(has_function_privilege('service_role', 'public.ai_import_start(uuid, text, uuid)', 'execute'),
  'the import function can start jobs');

select results_eq(
  $$select job_id, locale, region from public.ai_import_start(
      'a1a1a1a1-0000-0000-0000-000000000001', 'link', 'c0ffee00-0000-4000-8000-000000000001')$$,
  $$values ('c0ffee00-0000-4000-8000-000000000001'::uuid, 'en-AU', 'AU')$$,
  'a job starts with the ID the app gave');
select is(
  (select user_id from public.ai_import_jobs where id = 'c0ffee00-0000-4000-8000-000000000001'),
  'a1a1a1a1-0000-0000-0000-000000000001'::uuid,
  'the job belongs to the importer');
select throws_ok(
  $$select public.ai_import_start('a1a1a1a1-0000-0000-0000-000000000001', 'text',
      'c0ffee00-0000-4000-8000-000000000001')$$,
  'P0001', 'job ID missing or already used', 'a job ID cannot be used twice');
select throws_ok(
  $$select public.ai_import_start('b1b1b1b1-0000-0000-0000-000000000001', 'text',
      'c0ffee00-0000-4000-8000-000000000001')$$,
  'P0001', 'job ID missing or already used', 'another household cannot take over a job ID');
select throws_ok(
  $$select public.ai_import_start('a1a1a1a1-0000-0000-0000-000000000001', 'text', null)$$,
  'P0001', 'job ID missing or already used', 'a job ID is required');
select isnt_empty(
  $$select job_id from public.ai_import_start('a1a1a1a1-0000-0000-0000-000000000001', 'text')$$,
  'the two-argument form still starts a job with a fresh ID');

select set_config('request.jwt.claims',
  json_build_object('sub', 'b1b1b1b1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is_empty(
  $$select id from public.ai_import_jobs where id = 'c0ffee00-0000-4000-8000-000000000001'$$,
  'another household cannot read the job');

select set_config('request.jwt.claims',
  json_build_object('sub', 'a1a1a1a1-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select results_eq(
  $$select status from public.ai_import_jobs where id = 'c0ffee00-0000-4000-8000-000000000001'$$,
  $$values ('processing'::text)$$,
  'the importer reads the job by its ID');

reset role;
select * from finish();
rollback;
