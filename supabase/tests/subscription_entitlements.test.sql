-- M-01.2 (FR-PAY-1, FR-PAY-8, FR-PAY-9): subscription events reach household_entitlements
-- through one idempotent path that only the service role can call. Clients can't read the
-- event log or the mock store, and each lifecycle event sets the tier and status.
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- A mock-store event for household A, bought by A's parent.
create function tests.event(id text, type text, extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object(
    'id', id, 'type', type, 'source', 'mock', 'store', 'MOCK_STORE',
    'household_id', '00000000-0000-0000-0000-00000000000a',
    'app_user_id', 'aaaaaaaa-0000-0000-0000-000000000001',
    'product_id', 'pm_premium_monthly', 'period_type', 'NORMAL',
    'purchased_at', '2026-11-01T00:00:00Z', 'expiration_at', '2026-12-01T00:00:00Z',
    'event_at', now()) || extra
$$;

create function tests.apply(event jsonb) returns text language sql as $$
  select public.apply_subscription_event(event) ->> 'outcome'
$$;

create function tests.ent() returns public.household_entitlements language sql as $$
  select * from public.household_entitlements
  where household_id = '00000000-0000-0000-0000-00000000000a'
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

-- ---------------------------------------------------------------------------
-- Structure and access
-- ---------------------------------------------------------------------------
select is((tests.ent()).status, 'none', 'a new household has never subscribed');
select is((tests.ent()).tier, 'free', 'and is on Free');
select ok(
  exists (select 1 from pg_catalog.pg_publication_tables
          where pubname = 'supabase_realtime' and tablename = 'household_entitlements'),
  'entitlements are published to Realtime, so every member sees a purchase (FR-PAY-8)');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok($$select public.apply_subscription_event(tests.event('x', 'INITIAL_PURCHASE'))$$,
  '42501', null, 'a parent cannot apply a subscription event');
select throws_ok('select id from public.subscription_events', '42501', null,
  'a parent cannot read the event log');
select throws_ok('select app_user_id from public.mock_store_subscriptions', '42501', null,
  'a parent cannot read the mock store');
select throws_ok(
  $$insert into public.mock_store_subscriptions (app_user_id, household_id, product_id,
      period_type, original_purchased_at, period_started_at, expires_at, will_renew, clock_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
      'pm_premium_monthly', 'NORMAL', now(), now(), now() + interval '1 month', true, now())$$,
  '42501', null, 'a parent cannot write the mock store');
select throws_ok(
  $$update public.household_entitlements set tier = 'premium', source = 'mock'$$,
  '42501', null, 'a parent cannot grant Premium directly');
reset role;

-- ---------------------------------------------------------------------------
-- The lifecycle, as the service role (the Edge Functions)
-- ---------------------------------------------------------------------------
select tests.as_service();

select throws_ok($$select public.apply_subscription_event('{"id":"x","type":"RENEWAL"}')$$,
  '22023', null, 'an event without a source and time is refused');
select throws_ok(
  $$select public.apply_subscription_event(tests.event('x', 'RENEWAL', '{"source":"playstore"}'))$$,
  '22023', null, 'an unknown source is refused');

-- Trial start
select is(tests.apply(tests.event('e1', 'INITIAL_PURCHASE',
  '{"period_type":"TRIAL","expiration_at":"2026-11-15T00:00:00Z"}')), 'applied', 'trial start applies');
select is((tests.ent()).tier, 'premium', 'a trial is Premium');
select is((tests.ent()).status, 'trialing', 'with the trialing status');
select is((tests.ent()).trial_ends_at, '2026-11-15T00:00:00Z'::timestamptz, 'and the trial end');
select is((tests.ent()).source, 'mock', 'the entitlement records its source');
select is((tests.ent()).store, 'MOCK_STORE', 'and its store');
select is((tests.ent()).purchaser_user_id, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'and who bought it');
select ok((tests.ent()).will_renew, 'auto-renew is on');

-- Replay
select is(tests.apply(tests.event('e1', 'EXPIRATION')), 'duplicate',
  'a replayed event ID changes nothing, whatever it says');
select is((tests.ent()).tier, 'premium', 'so the household is still Premium');
select is((select count(*)::int from public.subscription_events where id = 'e1'), 1,
  'and the event is stored once');

-- Trial conversion
select is(tests.apply(tests.event('e2', 'RENEWAL', '{"is_trial_conversion":true,
  "purchased_at":"2026-11-15T00:00:00Z","expiration_at":"2026-12-15T00:00:00Z"}')), 'applied',
  'trial conversion applies');
select is((tests.ent()).status, 'active', 'a converted trial is active');
select is((tests.ent()).period_ends_at, '2026-12-15T00:00:00Z'::timestamptz,
  'with the new period end');

-- Product change
select tests.apply(tests.event('e3', 'PRODUCT_CHANGE', '{"new_product_id":"pm_premium_annual"}'));
select is((tests.ent()).pending_product_id, 'pm_premium_annual',
  'a plan switch waits for the next renewal');
select tests.apply(tests.event('e4', 'RENEWAL', '{"product_id":"pm_premium_annual",
  "purchased_at":"2026-12-15T00:00:00Z","expiration_at":"2027-12-15T00:00:00Z"}'));
select is((tests.ent()).product_id, 'pm_premium_annual', 'and takes effect at renewal');
select is((tests.ent()).pending_product_id, null, 'which clears the pending switch');

-- Cancellation and uncancellation
select tests.apply(tests.event('e5', 'CANCELLATION', '{"cancel_reason":"UNSUBSCRIBE"}'));
select is((tests.ent()).tier, 'premium', 'a cancelled subscription stays Premium until period end');
select ok(not (tests.ent()).will_renew, 'with auto-renew off');
select isnt((tests.ent()).cancelled_at, null, 'and the cancellation time');
select tests.apply(tests.event('e6', 'UNCANCELLATION'));
select ok((tests.ent()).will_renew, 'uncancelling turns auto-renew back on');
select is((tests.ent()).cancelled_at, null, 'and clears the cancellation');

-- Billing issue with a grace period
select tests.apply(tests.event('e7', 'BILLING_ISSUE',
  '{"grace_period_expiration_at":"2027-12-31T00:00:00Z"}'));
select is((tests.ent()).status, 'grace_period', 'a billing issue starts the grace period');
select is((tests.ent()).tier, 'premium', 'which is still Premium');
select is((tests.ent()).grace_ends_at, '2027-12-31T00:00:00Z'::timestamptz, 'until the grace end');
reset role;
select is(private.ai_monthly_allowance('00000000-0000-0000-0000-00000000000a'),
  private.ai_import_limit('monthly_premium'), 'grace keeps the Premium AI allowance');
select tests.as_service();

-- Expiration
select tests.apply(tests.event('e8', 'EXPIRATION', '{"expiration_reason":"BILLING_ERROR"}'));
select is((tests.ent()).tier, 'free', 'expiry returns the household to Free (FR-PAY-9)');
select is((tests.ent()).status, 'expired', 'with the expired status');
reset role;
select is(private.ai_monthly_allowance('00000000-0000-0000-0000-00000000000a'),
  private.ai_import_limit('monthly_free'), 'and the Free AI allowance');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(private.household_role('00000000-0000-0000-0000-00000000000a'), null,
  'the caregiver is paused after expiry');
reset role;
select is((select count(*)::int from public.household_members
           where household_id = '00000000-0000-0000-0000-00000000000a'), 2,
  'but their membership is kept');

-- Stale and unknown
select tests.as_service();
select is(tests.apply(tests.event('e0', 'RENEWAL', jsonb_build_object('event_at', now() - interval '1 day'))),
  'stale', 'an event older than the last one applied is recorded, not applied');
select is((tests.ent()).tier, 'free', 'so it does not bring Premium back');
select is(tests.apply(tests.event('u1', 'INITIAL_PURCHASE',
  '{"household_id":"00000000-0000-0000-0000-0000000000ff"}')), 'unknown_household',
  'an event for an unknown household changes nothing');
select is(tests.apply(tests.event('t1', 'TRANSFER')), 'ignored', 'unhandled types are ignored');

-- Re-subscribe, then refund
select tests.apply(tests.event('e9', 'INITIAL_PURCHASE'));
select is((tests.ent()).status, 'active', 'buying again restores Premium');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(private.household_role('00000000-0000-0000-0000-00000000000a'), 'caregiver',
  'and the caregiver''s access (FR-PAY-9)');
reset role;
select tests.as_service();
select tests.apply(tests.event('e10', 'CANCELLATION', '{"cancel_reason":"CUSTOMER_SUPPORT"}'));
select is((tests.ent()).tier, 'free', 'a refund ends Premium at once');
select is((tests.ent()).status, 'refunded', 'with the refunded status');
reset role;

-- Household B never saw any of it
select is((select tier from public.household_entitlements
           where household_id = '00000000-0000-0000-0000-00000000000b'), 'free',
  'other households are untouched');

select * from finish();
rollback;
