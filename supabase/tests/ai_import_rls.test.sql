-- R-05.1, FR-AI-8, FR-AI-9, FR-AI-16, NFR-SEC-9: AI import jobs and usage are isolated per
-- household; only the service role runs the import RPCs; caregivers can't import; the
-- monthly allowance and hourly limit come from app_config; failed imports don't count;
-- stale jobs release their reservation and old records are purged.
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create function tests.start(uid uuid, kind text default 'text') returns uuid language sql as $$
  select job_id from public.ai_import_start(uid, kind)
$$;

create function tests.used(household uuid) returns integer language sql as $$
  select coalesce((select imports_used from public.ai_usage
                   where household_id = household
                     and period = private.ai_usage_period(household)), 0)
$$;

create function tests.set_limit(name text, val integer) returns void language sql as $$
  update public.app_config set value = jsonb_set(value, array[name], to_jsonb(val))
  where key = 'ai_import.limits'
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: A is Premium (parent, family, caregiver); B is Free (parent); C is Free with a
-- family member, who has no access while C is on Free.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000002', 'c-family@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000001', 'nobody@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1),
  ('00000000-0000-0000-0000-00000000000c', 'Household C', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-000000000002', 'family');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.ai_import_start(uuid, text)', 'execute'),
  'members cannot start jobs directly');
select ok(not has_function_privilege('authenticated', 'public.ai_import_reserve(uuid)', 'execute'),
  'members cannot reserve allowance directly');
select ok(not has_function_privilege('authenticated',
  'public.ai_import_finish(uuid, text, text, jsonb, text, text, integer)', 'execute'),
  'members cannot finish jobs directly');
select ok(not has_function_privilege('anon', 'public.ai_import_start(uuid, text)', 'execute'),
  'anon cannot start jobs');
select ok(has_function_privilege('service_role', 'public.ai_import_start(uuid, text)', 'execute'),
  'the service role can start jobs');
select ok(has_function_privilege('service_role', 'public.ai_import_reserve(uuid)', 'execute'),
  'the service role can reserve allowance');
select ok(has_function_privilege('authenticated', 'public.ai_import_allowance()', 'execute'),
  'members can read their allowance');
select ok(not has_function_privilege('anon', 'public.ai_import_allowance()', 'execute'),
  'anon cannot read an allowance');

-- ---------------------------------------------------------------------------
-- Starting a job (FR-AI-16, FR-AI-14)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select tests.start('aaaaaaaa-0000-0000-0000-000000000003')$$,
  'P0001', 'caregivers cannot import', 'a caregiver is refused');
select throws_ok(
  $$select tests.start('cccccccc-0000-0000-0000-000000000002')$$,
  'P0001', 'not a household member', 'a family member of a Free household has no access');
select throws_ok(
  $$select tests.start('dddddddd-0000-0000-0000-000000000001')$$,
  'P0001', 'not a household member', 'a user with no household is refused');
select throws_ok(
  $$select public.ai_import_start('bbbbbbbb-0000-0000-0000-000000000001', 'voice')$$,
  '23514', null, 'an unknown input type is refused');
select results_eq(
  $$select household_id, locale, region
    from public.ai_import_start('aaaaaaaa-0000-0000-0000-000000000002', 'link')$$,
  $$values ('00000000-0000-0000-0000-00000000000a'::uuid, 'en-US', 'US')$$,
  'a family member of a Premium household can start, with the household''s locale and region');
select is(
  (select count(*)::int from public.ai_import_jobs
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status = 'processing'
     and reserved_period is null),
  1, 'starting a job reserves nothing');

-- ---------------------------------------------------------------------------
-- Allowance (FR-AI-8, FR-AI-9, D-9)
-- ---------------------------------------------------------------------------
select is(private.ai_monthly_allowance('00000000-0000-0000-0000-00000000000b'), 5,
  'Free allows 5 imports a month');
select is(private.ai_monthly_allowance('00000000-0000-0000-0000-00000000000a'), 100,
  'Premium allows 100 imports a month');
select is(private.ai_usage_period('00000000-0000-0000-0000-00000000000c'),
  date_trunc('month', now() at time zone 'Australia/Sydney')::date,
  'the period is the month in the household''s timezone');

create temp table b_jobs (n integer primary key, id uuid not null);
do $$
begin
  for i in 1..6 loop
    insert into b_jobs values (i, tests.start('bbbbbbbb-0000-0000-0000-000000000001'));
  end loop;
end;
$$;

select is(
  array(select public.ai_import_reserve(id) from b_jobs order by n),
  array[true, true, true, true, true, false],
  'reservations stop at the Free allowance');
select is(tests.used('00000000-0000-0000-0000-00000000000b'), 5, 'usage is 5 of 5');
select results_eq(
  $$select status, error_code, reserved_period from public.ai_import_jobs
    where id = (select id from b_jobs where n = 6)$$,
  $$values ('failed', 'import.quota_exceeded', null::date)$$,
  'the refused job fails with import.quota_exceeded');
select is(public.ai_import_reserve((select id from b_jobs where n = 2)), true,
  'reserving twice for one job is a no-op');
select is(tests.used('00000000-0000-0000-0000-00000000000b'), 5, 'and takes nothing more');

select lives_ok(
  $$select public.ai_import_finish((select id from b_jobs where n = 1), 'failed',
    p_error_code => 'import.parse_failed')$$,
  'a job can fail');
select is(tests.used('00000000-0000-0000-0000-00000000000b'), 4, 'a failed import gives its reservation back');
select lives_ok(
  $$select public.ai_import_finish((select id from b_jobs where n = 2), 'succeeded',
    p_source => 'parser', p_draft => '{"title": "x"}')$$,
  'a job can succeed');
select is(tests.used('00000000-0000-0000-0000-00000000000b'), 4, 'a successful import keeps its count');
select throws_ok(
  $$select public.ai_import_finish((select id from b_jobs where n = 2), 'failed',
    p_error_code => 'import.parse_failed')$$,
  'P0001', 'job is not processing', 'a finished job cannot be finished again');
select throws_ok(
  $$select public.ai_import_finish((select id from b_jobs where n = 3), 'failed')$$,
  '23514', null, 'a failure needs an error code');

insert into b_jobs values (7, tests.start('bbbbbbbb-0000-0000-0000-000000000001'));
select is(public.ai_import_reserve((select id from b_jobs where n = 7)), true,
  'the freed reservation can be used again');
insert into b_jobs values (8, tests.start('bbbbbbbb-0000-0000-0000-000000000001', 'link'));
select lives_ok(
  $$select public.ai_import_finish((select id from b_jobs where n = 8), 'succeeded',
    p_source => 'structured_data', p_draft => '{"title": "x"}')$$,
  'a structured-data import succeeds with the allowance used up');
select is(tests.used('00000000-0000-0000-0000-00000000000b'), 5,
  'a structured-data import does not count');

select tests.set_limit('monthly_free', 6);
insert into b_jobs values (9, tests.start('bbbbbbbb-0000-0000-0000-000000000001'));
select is(public.ai_import_reserve((select id from b_jobs where n = 9)), true,
  'a raised limit in app_config applies at once');

-- ---------------------------------------------------------------------------
-- Hourly rate limit (FR-AI-9)
-- ---------------------------------------------------------------------------
select tests.set_limit('hourly_per_member',
  (select count(*)::int from public.ai_import_jobs where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'));
select throws_ok(
  $$select tests.start('bbbbbbbb-0000-0000-0000-000000000001')$$,
  'P0001', 'hourly import limit reached', 'a member over the hourly limit is refused');
update public.ai_import_jobs set created_at = now() - interval '61 minutes'
where user_id = 'bbbbbbbb-0000-0000-0000-000000000001';
select lives_ok(
  $$select tests.start('bbbbbbbb-0000-0000-0000-000000000001')$$,
  'attempts older than an hour no longer count');

-- ---------------------------------------------------------------------------
-- Housekeeping (FR-AI-11, NFR-SEC-9)
-- ---------------------------------------------------------------------------
-- Jobs 3, 4, 5, 7 and 9 are still processing with reservations, and are now over an hour
-- old. Job 11 is new. Only job 2's success still counts afterwards.
select is(tests.used('00000000-0000-0000-0000-00000000000b'), 6, 'six reservations are held');
select private.ai_import_housekeeping();
select results_eq(
  $$select status, error_code, reserved_period from public.ai_import_jobs
    where id = (select id from b_jobs where n = 3)$$,
  $$values ('failed', 'import.timeout', null::date)$$,
  'a stale job fails with import.timeout');
select is(tests.used('00000000-0000-0000-0000-00000000000b'), 1,
  'stale jobs give their reservations back');
select is(
  (select status from public.ai_import_jobs where id = (
    select id from public.ai_import_jobs where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'
    order by created_at desc limit 1)),
  'processing', 'a recent job is left alone');
update public.ai_import_jobs set created_at = now() - interval '31 days'
where id = (select id from b_jobs where n = 2);
select private.ai_import_housekeeping();
select is_empty(
  $$select id from public.ai_import_jobs where id = (select id from b_jobs where n = 2)$$,
  'job records are purged after 30 days');
select isnt_empty(
  $$select jobid from cron.job where jobname = 'ai-import-housekeeping'
      and command = 'select private.ai_import_housekeeping()'$$,
  'housekeeping is scheduled');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
insert into b_jobs values (10, tests.start('aaaaaaaa-0000-0000-0000-000000000001'));
select public.ai_import_reserve((select id from b_jobs where n = 10));

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty(
  $$select id from public.ai_import_jobs where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'household B cannot read household A''s jobs');
select is_empty(
  $$select household_id from public.ai_usage where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'household B cannot read household A''s usage');
select isnt_empty(
  $$select id from public.ai_import_jobs where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  'a parent reads their own jobs');
select throws_ok(
  $$insert into public.ai_import_jobs (household_id, user_id, input_type, locale, region)
    values ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'text', 'en-GB', 'GB')$$,
  '42501', null, 'members cannot create jobs');
select throws_ok(
  $$update public.ai_usage set imports_used = 0$$,
  '42501', null, 'members cannot reset their usage');
select results_eq(
  $$select used, allowance from public.ai_import_allowance()$$,
  $$values (1, 6)$$,
  'the allowance RPC returns used of total');
select is(
  (select resets_on from public.ai_import_allowance()),
  (date_trunc('month', now() at time zone 'Europe/London') + interval '1 month')::date,
  'the allowance RPC returns the reset date');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty($$select id from public.ai_import_jobs$$, 'a caregiver reads no jobs');
select isnt_empty(
  $$select household_id from public.ai_usage$$, 'a caregiver can see the household''s usage');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.ai_import_jobs),
  1, 'a family member reads only their own jobs, not the parent''s');

select tests.as_postgres();
select * from finish();
rollback;
