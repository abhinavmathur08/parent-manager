-- A-04.3: account deletion (FR-PRIV-3), household deletion with the other parent's
-- confirmation (FR-PRIV-7), and the deletion registry every household table joins.
begin;
create extension if not exists pgtap with schema extensions;

select plan(59);

create schema tests;
grant usage on schema tests to anon, authenticated;

-- Acts as a user. `fresh` puts a sign-in a minute ago in the token's amr claim, as a
-- re-authentication does; otherwise the last sign-in was a day ago.
create function tests.as_user(uid uuid, fresh boolean default true) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated',
    'amr', json_build_array(json_build_object(
      'method', 'otp',
      'timestamp', extract(epoch from now())::bigint - case when fresh then 60 else 86400 end))
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Rows tied to a household, across every registered table.
create function tests.household_rows(hid uuid) returns bigint language plpgsql as $$
declare
  entry record;
  n bigint;
  total bigint := 0;
begin
  for entry in select table_name, column_name from private.deletion_registry where scope = 'household' loop
    execute format('select count(*) from %s where %I = $1', entry.table_name, entry.column_name)
    into n using hid;
    total := total + n;
  end loop;
  return total + (select count(*) from public.households where id = hid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Coverage: every table holding household data or user IDs is registered
-- ---------------------------------------------------------------------------

select is(
  array(
    select c.table_name::text from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'household_id'
      and not exists (
        select 1 from private.deletion_registry r
        where r.table_name = format('public.%I', c.table_name)::regclass
          and r.column_name = 'household_id' and r.scope = 'household')
    order by 1),
  array[]::text[],
  'every public table with a household_id is registered for household deletion');

select is(
  array(
    select format('%s.%s', con.conrelid::regclass, a.attname)
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
    join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = con.conrelid)
    where con.contype = 'f' and n.nspname = 'public'
      and con.confrelid in ('auth.users'::regclass, 'public.households'::regclass)
      and not exists (
        select 1 from private.deletion_registry r
        where r.table_name = con.conrelid and r.column_name = a.attname
          and r.scope = case when con.confrelid = 'auth.users'::regclass then 'user' else 'household' end)
    order by 1),
  array[]::text[],
  'every foreign key to auth.users or households is registered');

select is(
  array(
    select format('public.%s.%s', c.table_name, c.column_name) from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type = 'uuid'
      and (c.column_name like '%\_by' or c.column_name like '%user\_id')
      and not exists (
        select 1 from private.deletion_registry r
        where r.table_name = format('public.%I', c.table_name)::regclass
          and r.column_name = c.column_name and r.scope = 'user')
    order by 1),
  array[]::text[],
  'every uuid column naming a user (*_by, *user_id) is registered for account deletion');

select throws_ok(
  $$select private.register_for_deletion('public.households', 'name', 'household')$$,
  'P0001', 'register_for_deletion: public.households.name must be a uuid, not text',
  'only uuid columns can be registered');
select throws_ok(
  $$select private.register_for_deletion('public.household_members', 'missing', 'user')$$,
  'P0001', 'register_for_deletion: public.household_members has no column missing',
  'a missing column is refused');
select throws_ok(
  $$select private.register_for_deletion('public.invite_attempts', 'user_id', 'user', 'set_null')$$,
  'P0001', 'register_for_deletion: public.invite_attempts.user_id is not null, so it cannot be set null',
  'a not-null column cannot be set null');
select throws_ok(
  $$insert into private.deletion_registry (table_name, column_name, scope, action)
    values ('public.ai_usage', 'period', 'everyone', 'delete')$$,
  '23514', null, 'a column is registered against a household or a user');

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

-- A: parents A1 and A2, family member F. B: parent B1 alone. C: parent C1 and family C2.
-- D: parents D1 and D2. E: parent E1 and a caregiver E2 (Premium in practice; seats aren't
-- checked here). X: parent X1, never touched.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'f@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b1@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'c1@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000002', 'c2@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000001', 'd1@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000002', 'd2@example.test', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-0000-0000-000000000001', 'e1@example.test', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'e2@example.test', 'authenticated', 'authenticated'),
  ('ffffffff-0000-0000-0000-000000000001', 'x1@example.test', 'authenticated', 'authenticated');

insert into auth.identities (provider_id, user_id, identity_data, provider) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '{}', 'email');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1),
  ('00000000-0000-0000-0000-00000000000c', 'Household C', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1),
  ('00000000-0000-0000-0000-00000000000d', 'Household D', 'US', 'en-US', 'us_customary', 'America/Chicago', 7),
  ('00000000-0000-0000-0000-00000000000e', 'Household E', 'US', 'en-US', 'us_customary', 'America/Denver', 7),
  ('00000000-0000-0000-0000-0000000000ff', 'Household X', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'family'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000d', 'dddddddd-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000d', 'dddddddd-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000e', 'eeeeeeee-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000e', 'eeeeeeee-0000-0000-0000-000000000002', 'caregiver'),
  ('00000000-0000-0000-0000-0000000000ff', 'ffffffff-0000-0000-0000-000000000001', 'parent');

update public.profiles set display_name = 'Someone', active_household_id = m.household_id
from public.household_members m where m.user_id = profiles.id;

-- Household data in A and B: a child with an allergy, a household ingredient and its name,
-- a pantry item, an AI import and its usage, and an invitation.
insert into public.household_people (id, household_id, display_name, kind, age_band, linked_user_id)
select ('10000000-0000-0000-0000-0000000000' || s)::uuid, h::uuid, 'Child', 'child', 'toddler', null
from (values ('0a', '00000000-0000-0000-0000-00000000000a'),
             ('0b', '00000000-0000-0000-0000-00000000000b')) v(s, h);
insert into public.household_people (household_id, display_name, kind, age_band, linked_user_id) values
  ('00000000-0000-0000-0000-00000000000a', 'A1', 'adult', 'adult', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000000b', 'B1', 'adult', 'adult', 'bbbbbbbb-0000-0000-0000-000000000001');
insert into public.person_dietary (household_id, person_id, type, code) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'allergy', 'allergen.peanut'),
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'allergy', 'allergen.egg');
insert into public.ingredients (id, household_id, default_dimension)
select 'ingredient.h.' || replace(h, '-', ''), h::uuid, 'count'
from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b']) h;
insert into public.ingredient_names (ingredient_id, household_id, locale, name)
select 'ingredient.h.' || replace(h, '-', ''), h::uuid, 'en-US', 'Grandma''s sauce'
from unnest(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b']) h;
insert into public.pantry_items (household_id, ingredient_id, status, have_week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'ingredient.onion', 'have', '2026-11-08'),
  ('00000000-0000-0000-0000-00000000000b', 'ingredient.onion', 'have', '2026-11-09');
insert into public.ai_import_jobs (household_id, user_id, input_type, locale, region) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'text', 'en-US', 'US'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'text', 'en-GB', 'GB');
insert into public.ai_usage (household_id, period, imports_used) values
  ('00000000-0000-0000-0000-00000000000a', '2026-11-01', 1),
  ('00000000-0000-0000-0000-00000000000b', '2026-11-01', 1);
insert into public.invitations (household_id, role, invited_by, token_hash, expires_at) values
  ('00000000-0000-0000-0000-00000000000a', 'parent', 'aaaaaaaa-0000-0000-0000-000000000001', 'hash-a', now() + interval '7 days'),
  ('00000000-0000-0000-0000-00000000000b', 'parent', 'bbbbbbbb-0000-0000-0000-000000000001', 'hash-b', now() + interval '7 days');
update public.household_entitlements set purchaser_user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
where household_id = '00000000-0000-0000-0000-00000000000a';
insert into public.invite_attempts (user_id) values ('bbbbbbbb-0000-0000-0000-000000000001');

-- A synced table with a check column and a creator, like recipes and list items: the sync
-- rules freeze tombstones and keep who checked a row, and erasure must get past both.
create table public.erasure_probe (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.erasure_probe enable row level security;
select private.enable_sync('public.erasure_probe', array['done']);
select private.register_for_deletion('public.erasure_probe', 'household_id', 'household');
select private.register_for_deletion('public.erasure_probe', 'created_by', 'user', 'set_null');
select private.register_for_deletion('public.erasure_probe', 'done_by', 'user', 'set_null');
insert into public.erasure_probe (id, household_id, created_by) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001');
-- One is checked by A1, the other is a tombstone.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
reset role;
update public.erasure_probe set done = true, version = 1 where id = '20000000-0000-0000-0000-000000000001';
update public.erasure_probe set deleted_at = now(), version = 1 where id = '20000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.erasure_probe
   where created_by = 'aaaaaaaa-0000-0000-0000-000000000001' and (done_by is not null or deleted_at is not null)),
  2, 'the probe has a row checked by A1 and a tombstone, both created by A1');

select ok(tests.household_rows('00000000-0000-0000-0000-00000000000b') > 8, 'household B has data');
select set_config('tests.a_rows', tests.household_rows('00000000-0000-0000-0000-00000000000a')::text, true);
select set_config('tests.x_rows', tests.household_rows('00000000-0000-0000-0000-0000000000ff')::text, true);

-- ---------------------------------------------------------------------------
-- What deleting an account would do
-- ---------------------------------------------------------------------------

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(public.account_deletion_preview() ->> 'outcome', 'delete_household',
  'the only member deletes the household with their account');
reset role;
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(public.account_deletion_preview() ->> 'outcome', 'leave',
  'a parent with another parent leaves the household');
reset role;
select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select is(public.account_deletion_preview() ->> 'outcome', 'last_parent',
  'the last parent with a family member must promote someone first');
reset role;
select tests.as_user('eeeeeeee-0000-0000-0000-000000000001');
select is(public.account_deletion_preview() ->> 'outcome', 'last_parent',
  'a parent with only a caregiver must still hand over the household (FR-HH-14)');
reset role;

-- ---------------------------------------------------------------------------
-- Account deletion (FR-PRIV-3)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.delete_account()$$, '42501', 'not authenticated',
  'deleting needs a signed-in user');

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001', false);
select throws_ok($$select public.delete_account()$$, '42501', 'sign in again to confirm',
  'deleting needs a sign-in in the last 10 minutes');
reset role;

select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select throws_ok($$select public.delete_account()$$, 'P0001', 'the household needs a parent',
  'the last parent with others cannot delete their account');
reset role;
select is((select count(*)::int from auth.users where id = 'cccccccc-0000-0000-0000-000000000001'), 1,
  'and their account is kept');

-- The only member: the account, the household and everything in it go.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(public.delete_account(), '{"household_deleted": true}'::jsonb,
  'the only member deletes their account and household');
reset role;
select is(tests.household_rows('00000000-0000-0000-0000-00000000000b'), 0::bigint,
  'no row of household B remains in any registered table');
select is((select count(*)::int from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0,
  'the auth user is gone, so they cannot sign in to it again');
select is((select count(*)::int from auth.identities where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0,
  'and so are their sign-in identities');
select is(private.erasure_leftovers('bbbbbbbb-0000-0000-0000-000000000001'), array[]::text[],
  'no registered column names them');
select is((select count(*)::int from public.invite_attempts where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0,
  'their invite attempts are gone');
select is(tests.household_rows('00000000-0000-0000-0000-00000000000a')::text, current_setting('tests.a_rows'),
  'household A is untouched');
select is(tests.household_rows('00000000-0000-0000-0000-0000000000ff')::text, current_setting('tests.x_rows'),
  'household X is untouched');

-- A parent with a partner: the household carries on without them.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(public.delete_account(), '{"household_deleted": false}'::jsonb,
  'a parent with a partner deletes only their account');
reset role;
select is((select count(*)::int from public.households where id = '00000000-0000-0000-0000-00000000000a'), 1,
  'the partner keeps the household');
select is(
  array(select user_id::text from public.household_members
        where household_id = '00000000-0000-0000-0000-00000000000a' order by 1),
  array['aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003'],
  'and A1 no longer appears as a member');
select is((select count(*)::int from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'their profile is gone');
select is((select count(*)::int from public.household_people
           where household_id = '00000000-0000-0000-0000-00000000000a' and linked_user_id is null), 2,
  'people stay with the household, unlinked from the deleted account');
select is((select count(*)::int from public.invitations
           where household_id = '00000000-0000-0000-0000-00000000000a' and invited_by is null), 1,
  'their invitation stays, attributed to a former member');
select is((select count(*)::int from public.ai_import_jobs
           where household_id = '00000000-0000-0000-0000-00000000000a' and user_id is null), 1,
  'their import job stays with the household, without their ID');
select is((select purchaser_user_id from public.household_entitlements
           where household_id = '00000000-0000-0000-0000-00000000000a'), null::uuid,
  'the entitlement no longer names them');
select is((select count(*)::int from public.erasure_probe
           where created_by is null and done_by is null and done), 1,
  'a synced row they checked keeps its check but not their ID');
select is((select count(*)::int from public.erasure_probe
           where id = '20000000-0000-0000-0000-000000000002' and created_by is null and deleted_at is not null), 1,
  'a tombstone they created no longer names them');
select is(private.erasure_leftovers('aaaaaaaa-0000-0000-0000-000000000001'), array[]::text[],
  'no registered column names A1');

-- A trigger that writes the user's ID back is caught, and nothing is deleted.
create function tests.keep_creator() returns trigger language plpgsql as $$
begin
  new.created_by := old.created_by;
  return new;
end;
$$;
insert into public.erasure_probe (household_id, created_by) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002');
create trigger keep_creator before update on public.erasure_probe
  for each row execute function tests.keep_creator();
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select throws_ok($$select public.delete_account()$$, 'P0001', null,
  'deletion refuses to finish while a registered column still names the user');
reset role;
drop trigger keep_creator on public.erasure_probe;
select is((select count(*)::int from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000002'), 1,
  'and the refused deletion changed nothing');

-- ---------------------------------------------------------------------------
-- Household deletion (FR-PRIV-7)
-- ---------------------------------------------------------------------------

-- Only a parent of the household can ask.
select tests.as_user('ffffffff-0000-0000-0000-000000000001');
select throws_ok($$select public.request_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  '42501', 'only a parent can delete the household', 'another household''s parent cannot ask');
reset role;
select tests.as_user('cccccccc-0000-0000-0000-000000000002');
select throws_ok($$select public.request_household_deletion('00000000-0000-0000-0000-00000000000c')$$,
  '42501', 'only a parent can delete the household', 'a family member cannot ask');
reset role;
select tests.as_user('dddddddd-0000-0000-0000-000000000001', false);
select throws_ok($$select public.request_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  '42501', 'sign in again to confirm', 'asking needs a recent sign-in');
reset role;

-- With two parents, D1 asks and D2 must confirm.
select tests.as_user('dddddddd-0000-0000-0000-000000000001');
select is(public.request_household_deletion('00000000-0000-0000-0000-00000000000d') ->> 'status', 'requested',
  'with two parents, the request waits for the other');
select throws_ok($$select public.confirm_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  'P0002', 'no request to confirm', 'the parent who asked cannot confirm it');
reset role;
select tests.as_user('ffffffff-0000-0000-0000-000000000001');
select is((select count(*)::int from public.household_deletion_requests), 0,
  'another household cannot see the request');
select throws_ok($$select public.confirm_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  '42501', 'only a parent can delete the household', 'another household cannot confirm it');
select throws_ok($$select public.cancel_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  '42501', 'only a parent can do this', 'another household cannot cancel it');
select throws_ok(
  $$insert into public.household_deletion_requests (household_id, requested_by, expires_at)
    values ('00000000-0000-0000-0000-0000000000ff', 'ffffffff-0000-0000-0000-000000000001', now())$$,
  '42501', null, 'requests are made only through the RPC');
reset role;
select tests.as_user('dddddddd-0000-0000-0000-000000000002', false);
select is((select count(*)::int from public.household_deletion_requests), 1,
  'the other parent sees the request');
select throws_ok($$select public.confirm_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  '42501', 'sign in again to confirm', 'confirming needs a recent sign-in');
reset role;

-- A lapsed request can't be confirmed.
update public.household_deletion_requests set expires_at = now() - interval '1 minute';
select tests.as_user('dddddddd-0000-0000-0000-000000000002');
select throws_ok($$select public.confirm_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  'P0002', 'no request to confirm', 'a request older than 7 days has lapsed');
reset role;
update public.household_deletion_requests set expires_at = now() + interval '1 day';

-- D2 declines, then D1 asks again and D2 confirms.
select tests.as_user('dddddddd-0000-0000-0000-000000000002');
select lives_ok($$select public.cancel_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  'the other parent can decline');
select is((select count(*)::int from public.household_deletion_requests), 0, 'which removes the request');
reset role;
select tests.as_user('dddddddd-0000-0000-0000-000000000001');
select public.request_household_deletion('00000000-0000-0000-0000-00000000000d');
reset role;
select tests.as_user('dddddddd-0000-0000-0000-000000000002');
select lives_ok($$select public.confirm_household_deletion('00000000-0000-0000-0000-00000000000d')$$,
  'the other parent confirms');
reset role;
select is(tests.household_rows('00000000-0000-0000-0000-00000000000d'), 0::bigint,
  'no row of household D remains, the request included');
select is((select count(*)::int from auth.users where id in
  ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')), 2,
  'both parents keep their accounts, ready to create or join another household');
select is((select count(*)::int from public.profiles where active_household_id is not null and id in
  ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')), 0,
  'and their profiles no longer point at it');

-- The only parent deletes at once, with a caregiver in the household.
select tests.as_user('eeeeeeee-0000-0000-0000-000000000001');
select is(public.request_household_deletion('00000000-0000-0000-0000-00000000000e') ->> 'status', 'deleted',
  'the only parent deletes the household at once');
reset role;
select is(tests.household_rows('00000000-0000-0000-0000-00000000000e'), 0::bigint,
  'and nothing of household E remains');
select is(tests.household_rows('00000000-0000-0000-0000-0000000000ff')::text, current_setting('tests.x_rows'),
  'household X is still untouched');

select * from finish();
rollback;
