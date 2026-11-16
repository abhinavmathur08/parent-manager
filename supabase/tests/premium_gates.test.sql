-- M-03 (FR-PAY-3, FR-PAY-9, FR-PAY-10, FR-HH-1, FR-AI-9): Premium gates follow the server
-- entitlement through a whole lapse and return, driven by real subscription events; safety,
-- privacy and export features never read the tier.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Applies a mock-store event to household A as the service role, then returns to postgres.
create function tests.event(id text, type text, extra jsonb default '{}') returns text
language plpgsql security definer as $$
declare
  outcome text;
begin
  select public.apply_subscription_event(jsonb_build_object(
    'id', id, 'type', type, 'source', 'mock', 'store', 'MOCK_STORE',
    'household_id', '00000000-0000-0000-0000-00000000000a',
    'app_user_id', 'aaaaaaaa-0000-0000-0000-000000000001',
    'product_id', 'pm_premium_monthly', 'period_type', 'NORMAL',
    'purchased_at', now(), 'expiration_at', now() + interval '1 month',
    'event_at', clock_timestamp()) || extra) ->> 'outcome'
  into outcome;
  return outcome;
end;
$$;

create table tests.codes (label text primary key, code text);
grant all on tests.codes to authenticated;

create function tests.invite(label text, role text) returns void language sql as $$
  insert into tests.codes
  select label, public.create_invitation('00000000-0000-0000-0000-00000000000a', role) ->> 'code'
$$;

create function tests.code(label text) returns text language sql as $$
  select code from tests.codes where codes.label = code.label
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'joiner@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver');

insert into public.household_people (id, household_id, display_name, kind, age_band) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Bean', 'child', 'toddler');

-- ---------------------------------------------------------------------------
-- Free: the seats wait for Premium (FR-HH-1)
-- ---------------------------------------------------------------------------
select ok(not private.household_is_premium('00000000-0000-0000-0000-00000000000a'),
  'a new household is not Premium');
select is(private.ai_monthly_allowance('00000000-0000-0000-0000-00000000000a'),
  private.ai_import_limit('monthly_free'), 'Free has the free AI allowance (FR-AI-9)');
select is(private.ai_import_limit('monthly_free'), 5, 'which is 5 a month (D-9)');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok($$select tests.invite('fam', 'family')$$, 'P0001', null,
  'Free: a parent cannot invite a family member');
select throws_ok($$select tests.invite('care', 'caregiver')$$, 'P0001', null,
  'Free: nor a caregiver');
select lives_ok($$select tests.invite('partner', 'parent')$$,
  'Free: inviting the second parent is free');
reset role;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(private.household_role('00000000-0000-0000-0000-00000000000a'), null,
  'Free: a caregiver has no access');
reset role;

-- ---------------------------------------------------------------------------
-- A trial starts: everything opens
-- ---------------------------------------------------------------------------
select is(tests.event('p1', 'INITIAL_PURCHASE', '{"period_type":"TRIAL"}'), 'applied',
  'a trial starts');
select ok(private.household_is_premium('00000000-0000-0000-0000-00000000000a'),
  'a trial is Premium');
select is(private.ai_monthly_allowance('00000000-0000-0000-0000-00000000000a'),
  private.ai_import_limit('monthly_premium'), 'with the Premium AI allowance');
select is(private.ai_import_limit('monthly_premium'), 100, 'which is 100 a month (D-9)');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(private.household_role('00000000-0000-0000-0000-00000000000a'), 'caregiver',
  'the caregiver has access');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok($$select tests.invite('care', 'caregiver')$$, 'a caregiver can be invited');
reset role;

-- Some usage this month, which must survive the lapse.
insert into public.ai_usage (household_id, period, imports_used)
values ('00000000-0000-0000-0000-00000000000a',
  private.ai_usage_period('00000000-0000-0000-0000-00000000000a'), 7);

-- ---------------------------------------------------------------------------
-- Lapse (FR-PAY-9)
-- ---------------------------------------------------------------------------
select is(tests.event('p2', 'EXPIRATION'), 'applied', 'the subscription expires');
select ok(not private.household_is_premium('00000000-0000-0000-0000-00000000000a'),
  'the household is on Free');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(private.household_role('00000000-0000-0000-0000-00000000000a'), null,
  'the caregiver is paused');
select is_empty('select id from public.household_people', 'and sees none of the household''s data');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select is(private.household_role('00000000-0000-0000-0000-00000000000a'), null,
  'the family member is paused too');
reset role;
select is((select count(*)::int from public.household_members
           where household_id = '00000000-0000-0000-0000-00000000000a' and status = 'active'), 3,
  'every membership is kept');

select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select is(public.accept_invitation(tests.code('care')) ->> 'status', 'premium_required',
  'a pending caregiver invitation is suspended');
reset role;

select is(private.ai_monthly_allowance('00000000-0000-0000-0000-00000000000a'), 5,
  'the AI allowance drops to the free number');
select is((select imports_used from public.ai_usage
           where household_id = '00000000-0000-0000-0000-00000000000a'), 7,
  'and imports already used this month still count');

-- Never charged for (FR-PAY-10): the parent keeps safety features on Free.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.person_dietary (household_id, person_id, type, code)
    values ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-000000000001',
      'allergy', 'allergen.peanut')$$,
  'a parent on Free can record an allergy');
select is((select count(*)::int from public.person_dietary), 1, 'and see it');
reset role;

-- ---------------------------------------------------------------------------
-- Premium returns: access comes back fully
-- ---------------------------------------------------------------------------
select is(tests.event('p3', 'INITIAL_PURCHASE'), 'applied', 'a parent subscribes again');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(private.household_role('00000000-0000-0000-0000-00000000000a'), 'caregiver',
  'the caregiver''s access returns');
reset role;
select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select is(public.accept_invitation(tests.code('care')) ->> 'status', 'ok',
  'the suspended invitation can be accepted');
reset role;

-- ---------------------------------------------------------------------------
-- The free history window (FR-PAY-6, D-9): this week and the 4 before it
-- ---------------------------------------------------------------------------
select is(extract(dow from private.free_history_start('00000000-0000-0000-0000-00000000000a'))::int, 0,
  'the window starts on the household''s week start (Sunday)');
select ok(
  (now() at time zone 'America/New_York')::date
    - private.free_history_start('00000000-0000-0000-0000-00000000000a') between 28 and 34,
  'and goes back 4 weeks before the current week');

-- ---------------------------------------------------------------------------
-- FR-PAY-10: no safety, privacy or export function or policy reads the tier
-- ---------------------------------------------------------------------------
select is_empty(
  $$select p.proname from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (p.proname ~ '(delet|erase|export|privacy|dietary|allerg)')
      and p.prosrc ~* '(household_entitlements|household_is_premium|tier)'$$,
  'deletion, export, privacy and allergy functions never read the tier');
select is_empty(
  $$select tablename from pg_catalog.pg_policies
    where tablename in ('person_dietary', 'household_people', 'profiles')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~* '(entitlement|tier|premium)'$$,
  'allergy and privacy policies never read the tier');

select * from finish();
rollback;
