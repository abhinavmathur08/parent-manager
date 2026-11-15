-- M-01.2: server entitlements (spec FR-PAY-1, FR-PAY-8, FR-PAY-9; architecture section 8).
--
-- `household_entitlements` stays the single source of truth for the tier. Subscription events
-- (RevenueCat's webhook later, the mock store now) reach it through one idempotent path,
-- `public.apply_subscription_event`, which only the service role can call.
--
-- The mock store keeps its own record in `mock_store_subscriptions`, as a real store would.
-- Nothing here turns the mock on: the `mock-store` Edge Function refuses every request unless
-- the project sets the Edge Function secret BILLING_MOCK_ENABLED=true. No migration sets it.

-- ---------------------------------------------------------------------------
-- household_entitlements: the subscription's state, and where it came from
-- ---------------------------------------------------------------------------
alter table public.household_entitlements
  drop constraint household_entitlements_status_check;

-- `none`: never subscribed. `trialing`, `active` and `grace_period` are Premium; `expired` and
-- `refunded` are Free. A cancelled subscription stays `active` or `trialing`, with
-- will_renew = false, until its period ends (FR-PAY-9).
update public.household_entitlements set status = 'none'
where tier = 'free' and status = 'active' and purchaser_user_id is null;

alter table public.household_entitlements
  alter column status set default 'none',
  add constraint household_entitlements_status_check
    check (status in ('none', 'trialing', 'active', 'grace_period', 'expired', 'refunded')),
  -- Which provider granted it. The mock never runs in production (see above).
  add column source text check (source in ('mock', 'revenuecat')),
  add column store text check (store in ('MOCK_STORE', 'APP_STORE', 'PLAY_STORE')),
  add column product_id text,
  -- A plan switch that takes effect at the next renewal.
  add column pending_product_id text,
  add column period_type text check (period_type in ('NORMAL', 'TRIAL')),
  add column period_started_at timestamptz,
  add column trial_ends_at timestamptz,
  add column original_purchase_at timestamptz,
  add column will_renew boolean not null default false,
  add column cancelled_at timestamptz,
  add column billing_issue_at timestamptz,
  add column grace_ends_at timestamptz,
  add column last_event_id text,
  add column last_event_at timestamptz;

comment on column public.household_entitlements.source is
  'mock or revenuecat. Set only by public.apply_subscription_event.';

-- Every member sees a purchase within 60 seconds (FR-PAY-8): devices listen on Realtime,
-- which applies the members-only select policy.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'household_entitlements'
    ) then
    alter publication supabase_realtime add table public.household_entitlements;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- subscription_events: every event received, once (idempotent on the event ID)
-- ---------------------------------------------------------------------------
create table public.subscription_events (
  id text primary key,
  household_id uuid references public.households (id) on delete cascade,
  purchaser_user_id uuid references auth.users (id) on delete set null,
  source text not null check (source in ('mock', 'revenuecat')),
  type text not null,
  product_id text,
  event_at timestamptz not null,
  received_at timestamptz not null default now(),
  -- applied, stale (older than the last applied event), ignored (a type we don't act on) or
  -- unknown_household.
  outcome text not null,
  -- The normalized event (architecture section 8). It holds IDs, product codes and dates only.
  payload jsonb not null
);

create index subscription_events_household_idx on public.subscription_events (household_id);

alter table public.subscription_events enable row level security;
revoke all on public.subscription_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- mock_store_subscriptions: the mock store's own record (D-10 interim)
-- ---------------------------------------------------------------------------
-- One subscription per store account (the Supabase user), as a store's subscription group
-- allows. Re-subscribing after expiry reuses the row. Only the service role reads it.
create table public.mock_store_subscriptions (
  app_user_id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  product_id text not null,
  period_type text not null check (period_type in ('NORMAL', 'TRIAL')),
  original_purchased_at timestamptz not null,
  period_started_at timestamptz not null,
  expires_at timestamptz not null,
  will_renew boolean not null,
  unsubscribed_at timestamptz,
  billing_issue_at timestamptz,
  grace_ends_at timestamptz,
  pending_product_id text,
  -- The test clock marks the next renewal to fail with a billing issue.
  fail_next_renewal boolean not null default false,
  -- Set when the subscription ended (expired or refunded).
  ended_at timestamptz,
  had_trial boolean not null default false,
  -- The mock store's own clock. The test clock moves it forward; it never runs behind now().
  clock_at timestamptz not null,
  -- Events held back to imitate a delayed webhook, delivered on restore.
  pending_events jsonb not null default '[]'::jsonb,
  -- The latest event sent, which restore sends again.
  last_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live mock subscription per household: the second parent can't buy (spec 3.13).
create unique index mock_store_subscriptions_live_household_idx
  on public.mock_store_subscriptions (household_id) where ended_at is null;

create trigger set_updated_at before update on public.mock_store_subscriptions
  for each row execute function private.set_updated_at();

alter table public.mock_store_subscriptions enable row level security;
revoke all on public.mock_store_subscriptions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deletion (A-04.3) and export (A-04.2)
-- ---------------------------------------------------------------------------
select private.register_for_deletion('public.subscription_events', 'household_id', 'household');
select private.register_for_deletion('public.subscription_events', 'purchaser_user_id', 'user',
  'set_null');
select private.register_for_deletion('public.mock_store_subscriptions', 'household_id',
  'household');
select private.register_for_deletion('public.mock_store_subscriptions', 'app_user_id', 'user');

-- The export registry arrives with A-04.2 (#205). Register when it exists, so this migration
-- works whichever merges first.
do $$
begin
  if to_regprocedure('private.register_for_export(regclass, text, text, text[], text)')
    is not null then
    execute $sql$
      select private.register_for_export('public.subscription_events', 'household',
        'household_id');
      select private.register_for_export('public.mock_store_subscriptions', 'none',
        reason => 'the mock store''s own record; the entitlement it grants is exported');
    $sql$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The one path that changes a household's entitlement
-- ---------------------------------------------------------------------------
-- Takes a normalized event, modelled on RevenueCat's webhook types (architecture section 8):
--   { id, type, source, store, household_id, app_user_id, product_id, new_product_id,
--     period_type, purchased_at, expiration_at, event_at, grace_period_expiration_at,
--     cancel_reason, expiration_reason, is_trial_conversion }
-- Types: INITIAL_PURCHASE (a trial start when period_type is TRIAL), RENEWAL (a trial
-- conversion when is_trial_conversion), CANCELLATION (a refund when cancel_reason is
-- CUSTOMER_SUPPORT), UNCANCELLATION, BILLING_ISSUE, EXPIRATION and PRODUCT_CHANGE.
-- Replaying an event changes nothing (idempotent on id), and an event older than the last one
-- applied is recorded but not applied.
create function public.apply_subscription_event(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id text := event ->> 'id';
  event_type text := event ->> 'type';
  target uuid := (event ->> 'household_id')::uuid;
  purchaser uuid := (event ->> 'app_user_id')::uuid;
  event_at timestamptz := (event ->> 'event_at')::timestamptz;
  expires timestamptz := (event ->> 'expiration_at')::timestamptz;
  ent public.household_entitlements;
  result text;
begin
  if event_id is null or event_type is null or event_at is null
    or event ->> 'source' not in ('mock', 'revenuecat') then
    raise exception 'invalid subscription event' using errcode = '22023';
  end if;

  if purchaser is not null and not exists (select 1 from auth.users u where u.id = purchaser) then
    purchaser := null;
  end if;

  select * into ent from public.household_entitlements e
  where e.household_id = target
  for update;

  result := case
    when ent.household_id is null then 'unknown_household'
    when ent.last_event_at is not null and event_at < ent.last_event_at then 'stale'
    when event_type in ('INITIAL_PURCHASE', 'RENEWAL', 'CANCELLATION', 'UNCANCELLATION',
      'BILLING_ISSUE', 'EXPIRATION', 'PRODUCT_CHANGE') then 'applied'
    else 'ignored'
  end;

  insert into public.subscription_events
    (id, household_id, purchaser_user_id, source, type, product_id, event_at, outcome, payload)
  values (event_id, ent.household_id, purchaser, event ->> 'source', event_type,
    event ->> 'product_id', event_at, result, event)
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if result <> 'applied' then
    return jsonb_build_object('outcome', result);
  end if;

  if event_type = 'INITIAL_PURCHASE' then
    update public.household_entitlements set
      tier = 'premium',
      status = case when event ->> 'period_type' = 'TRIAL' then 'trialing' else 'active' end,
      source = event ->> 'source',
      store = event ->> 'store',
      product_id = event ->> 'product_id',
      pending_product_id = null,
      period_type = event ->> 'period_type',
      period_started_at = (event ->> 'purchased_at')::timestamptz,
      period_ends_at = expires,
      trial_ends_at = case when event ->> 'period_type' = 'TRIAL' then expires end,
      original_purchase_at = (event ->> 'purchased_at')::timestamptz,
      will_renew = true,
      cancelled_at = null,
      billing_issue_at = null,
      grace_ends_at = null,
      purchaser_user_id = purchaser,
      rc_app_user_id = event ->> 'app_user_id'
    where household_id = target;
  elsif event_type = 'RENEWAL' then
    update public.household_entitlements set
      tier = 'premium',
      status = 'active',
      source = event ->> 'source',
      store = event ->> 'store',
      product_id = event ->> 'product_id',
      pending_product_id = null,
      period_type = 'NORMAL',
      period_started_at = (event ->> 'purchased_at')::timestamptz,
      period_ends_at = expires,
      will_renew = true,
      cancelled_at = null,
      billing_issue_at = null,
      grace_ends_at = null
    where household_id = target;
  elsif event_type = 'CANCELLATION' and event ->> 'cancel_reason' = 'CUSTOMER_SUPPORT' then
    -- A refund ends Premium at once (spec 3.13: treated as a lapse).
    update public.household_entitlements set
      tier = 'free',
      status = 'refunded',
      period_ends_at = coalesce(expires, event_at),
      will_renew = false,
      cancelled_at = event_at,
      pending_product_id = null,
      grace_ends_at = null
    where household_id = target;
  elsif event_type = 'CANCELLATION' then
    -- Auto-renew is off; Premium stays until the period ends (FR-PAY-9).
    update public.household_entitlements set will_renew = false, cancelled_at = event_at
    where household_id = target;
  elsif event_type = 'UNCANCELLATION' then
    update public.household_entitlements set will_renew = true, cancelled_at = null
    where household_id = target;
  elsif event_type = 'BILLING_ISSUE' then
    -- Premium continues through the store's grace period, if it has one.
    update public.household_entitlements set
      status = case
        when (event ->> 'grace_period_expiration_at') is not null and tier = 'premium'
          then 'grace_period' else status end,
      billing_issue_at = event_at,
      grace_ends_at = (event ->> 'grace_period_expiration_at')::timestamptz
    where household_id = target;
  elsif event_type = 'EXPIRATION' then
    update public.household_entitlements set
      tier = 'free',
      status = 'expired',
      period_ends_at = coalesce(expires, period_ends_at),
      will_renew = false,
      pending_product_id = null,
      grace_ends_at = null
    where household_id = target;
  elsif event_type = 'PRODUCT_CHANGE' then
    update public.household_entitlements set pending_product_id = event ->> 'new_product_id'
    where household_id = target;
  end if;

  update public.household_entitlements set last_event_id = event_id, last_event_at = event_at
  where household_id = target
  returning * into ent;

  return jsonb_build_object('outcome', 'applied', 'tier', ent.tier, 'status', ent.status);
end;
$$;

revoke all on function public.apply_subscription_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_subscription_event(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Tier checks follow the tier column only: trials and grace periods are Premium.
-- ---------------------------------------------------------------------------
create or replace function private.ai_monthly_allowance(target_household_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when e.tier = 'premium' then private.ai_import_limit('monthly_premium')
    else private.ai_import_limit('monthly_free')
  end
  from public.households h
  left join public.household_entitlements e on e.household_id = h.id
  where h.id = target_household_id
$$;
