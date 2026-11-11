-- H-03.1: creating, previewing, accepting and revoking invitations (FR-HH-1, FR-HH-2,
-- FR-HH-7, FR-HH-9, NFR-SEC-8), and that invite_attempts is closed to clients.
begin;
create extension if not exists pgtap with schema extensions;

select plan(47);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Saves create_invitation's result so later assertions can use the code and token.
create table tests.invites (label text primary key, result jsonb);
grant all on tests.invites to authenticated;

create function tests.invite(label text, household uuid, invite_role text) returns jsonb
language plpgsql as $$
declare
  result jsonb := public.create_invitation(household, invite_role);
begin
  insert into tests.invites values (label, result);
  return result;
end;
$$;

create function tests.code(label text) returns text language sql as $$
  select result ->> 'code' from tests.invites where tests.invites.label = code.label
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (free, one parent), household P (Premium, one parent), household B
-- (two parents), and people with no household.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent1@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b-parent2@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000001', 'p-parent@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000001', 'joiner1@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000002', 'joiner2@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000003', 'joiner3@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000004', 'guesser@example.test', 'authenticated', 'authenticated');

update public.profiles set display_name = 'Sam' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1),
  ('00000000-0000-0000-0000-00000000000d', 'Household P', 'AU', 'en-AU', 'metric', 'Australia/Sydney', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000d', 'dddddddd-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000d';

-- ---------------------------------------------------------------------------
-- Creating (FR-HH-1, FR-HH-2, NFR-SEC-8)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select tests.invite('partner', '00000000-0000-0000-0000-00000000000a', 'parent');
select tests.invite('revoke-me', '00000000-0000-0000-0000-00000000000a', 'parent');
select tests.invite('expire-me', '00000000-0000-0000-0000-00000000000a', 'parent');
select tests.invite('by-link', '00000000-0000-0000-0000-00000000000a', 'parent');
select tests.invite('code-' || n, '00000000-0000-0000-0000-00000000000a', 'parent')
from generate_series(1, 40) n;

select ok(
  (select bool_and(result ->> 'code' ~ '^[2-9A-HJ-NP-Z]{6}$') from tests.invites),
  'codes are 6 characters with no 0, O, 1 or I');
select is((select count(distinct result ->> 'code')::int from tests.invites), 44,
  'every open invitation gets its own code');
select ok(
  (select bool_and(char_length(result ->> 'token') >= 40) from tests.invites),
  'link tokens are long and random');
select is(
  (select expires_at from public.invitations where id = (
    select (result ->> 'id')::uuid from tests.invites where label = 'partner')),
  now() + interval '7 days', 'invitations expire after 7 days');
select throws_ok('select token_hash from public.invitations', '42501', null,
  'parents cannot read token hashes');
select throws_ok('select code_hash from public.invitations', '42501', null,
  'parents cannot read code hashes');
select is(
  (select role from public.invitations where id = (
    select (result ->> 'id')::uuid from tests.invites where label = 'partner')),
  'parent', 'parents can read their pending invitations');
select throws_ok(
  $$select public.create_invitation('00000000-0000-0000-0000-00000000000a', 'caregiver')$$,
  'P0001', 'this role needs Premium', 'a free household cannot invite a caregiver');
select throws_ok(
  $$select public.create_invitation('00000000-0000-0000-0000-00000000000a', 'family')$$,
  'P0001', 'this role needs Premium', 'a free household cannot invite a family member');
select throws_ok(
  $$select public.create_invitation('00000000-0000-0000-0000-00000000000b', 'parent')$$,
  '42501', null, 'a parent cannot invite to another household');

reset role;
select ok(
  not exists (
    select 1 from public.invitations i join tests.invites t on (t.result ->> 'id')::uuid = i.id
    where i.code_hash = t.result ->> 'code' or i.token_hash = t.result ->> 'token'
      or i.code_hash is null or i.token_hash is null),
  'only hashes of codes and tokens are stored');

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.create_invitation('00000000-0000-0000-0000-00000000000b', 'parent')$$,
  'P0001', 'the household has two parents', 'a third parent cannot be invited');
select is_empty(
  $$select id from public.invitations where household_id = '00000000-0000-0000-0000-00000000000a'$$,
  'another household''s parent cannot read the invitations');
select throws_ok(
  format('select public.revoke_invitation(%L)',
    (select result ->> 'id' from tests.invites where label = 'revoke-me')),
  '42501', null, 'another household''s parent cannot revoke an invitation');
reset role;

select tests.as_user('cccccccc-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.create_invitation('00000000-0000-0000-0000-00000000000a', 'parent')$$,
  '42501', null, 'someone outside the household cannot invite');
select is_empty('select id from public.invitations', 'someone outside sees no invitations');
select throws_ok('select * from public.invite_attempts', '42501', null,
  'clients cannot read invite attempts');
select throws_ok('insert into public.invite_attempts (user_id) values (auth.uid())', '42501', null,
  'clients cannot write invite attempts');

-- ---------------------------------------------------------------------------
-- Previewing and accepting (FR-HH-4, FR-HH-6, FR-HH-7)
-- ---------------------------------------------------------------------------
select is(
  public.preview_invitation(lower(substr(tests.code('partner'), 1, 3)) || ' ' || substr(tests.code('partner'), 4)),
  jsonb_build_object('status', 'ok', 'household_name', 'Household A', 'inviter_name', 'Sam',
    'role', 'parent', 'expires_at', now() + interval '7 days'),
  'the preview shows the household, inviter and role for a code in any case with spaces');
select is(public.accept_invitation(tests.code('partner')) ->> 'status', 'ok',
  'a parent invitation can be accepted');
select is(
  (select role from public.household_members
   where household_id = '00000000-0000-0000-0000-00000000000a' and user_id = auth.uid()),
  'parent', 'accepting makes the caller a parent of the household');
select is(
  (select active_household_id from public.profiles where id = auth.uid()),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'accepting sets the active household');
select is(
  (select accepted_by from public.invitations where id = (
    select (result ->> 'id')::uuid from tests.invites where label = 'partner')),
  auth.uid(), 'the invitation records who accepted it');
reset role;

select tests.as_user('cccccccc-0000-0000-0000-000000000002');
select is(public.accept_invitation(tests.code('partner')), '{"status": "used"}'::jsonb,
  'an invitation cannot be used twice');
select is(public.accept_invitation(tests.code('code-1')), '{"status": "seat_limit"}'::jsonb,
  'a third parent is rejected on the server, even with an older invitation');
reset role;

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  format('select public.revoke_invitation(%L)',
    (select result ->> 'id' from tests.invites where label = 'revoke-me')),
  'a parent can revoke an invitation');
select throws_ok(
  format('select public.revoke_invitation(%L)',
    (select result ->> 'id' from tests.invites where label = 'partner')),
  'P0001', 'already accepted', 'an accepted invitation cannot be revoked');
reset role;

update public.invitations set expires_at = now() - interval '1 minute'
where id = (select (result ->> 'id')::uuid from tests.invites where label = 'expire-me');

select tests.as_user('cccccccc-0000-0000-0000-000000000002');
select is(public.preview_invitation(tests.code('revoke-me')), '{"status": "revoked"}'::jsonb,
  'a revoked invitation shows as revoked');
select is(public.accept_invitation(tests.code('revoke-me')), '{"status": "revoked"}'::jsonb,
  'a revoked invitation cannot be accepted');
select is(public.accept_invitation(tests.code('expire-me')), '{"status": "expired"}'::jsonb,
  'an expired invitation cannot be accepted');
select is(public.accept_invitation('ABCDEFGH'), '{"status": "invalid"}'::jsonb,
  'an unknown code is invalid');
select is(
  public.accept_invitation(null, (select result ->> 'token' from tests.invites where label = 'by-link'))
    ->> 'status',
  'seat_limit', 'a link token finds its invitation');
reset role;

-- A Premium household with one free seat left.
insert into public.app_config (key, value) values ('household.premium_seats', '1');
select tests.as_user('dddddddd-0000-0000-0000-000000000001');
select tests.invite('family', '00000000-0000-0000-0000-00000000000d', 'family');
select tests.invite('caregiver', '00000000-0000-0000-0000-00000000000d', 'caregiver');
select tests.invite('p-partner', '00000000-0000-0000-0000-00000000000d', 'parent');
reset role;

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(public.preview_invitation(tests.code('family')) ->> 'status', 'in_other_household',
  'someone in another household is asked to leave it first');
select is(public.accept_invitation(tests.code('family')) ->> 'status', 'in_other_household',
  'someone in another household cannot accept');
reset role;

select tests.as_user('cccccccc-0000-0000-0000-000000000002');
select is(public.accept_invitation(tests.code('family')) ->> 'role', 'family',
  'a Premium household can take a family member');
select is(public.accept_invitation(tests.code('p-partner')) ->> 'status', 'already_member',
  'a member cannot accept another invitation to the same household');
reset role;

select tests.as_user('cccccccc-0000-0000-0000-000000000003');
select is(public.accept_invitation(tests.code('caregiver')) ->> 'status', 'seat_limit',
  'the Premium seat cap is enforced');
reset role;

update public.app_config set value = '6' where key = 'household.premium_seats';
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000d';
select tests.as_user('cccccccc-0000-0000-0000-000000000003');
select is(public.accept_invitation(tests.code('caregiver')) ->> 'status', 'premium_required',
  'a caregiver invitation waits while the household is on Free');
select is(public.accept_invitation(tests.code('p-partner')) ->> 'status', 'ok',
  'a parent invitation still works on Free');
reset role;

-- A removed member can be invited back.
update public.household_members set status = 'removed'
where user_id = 'cccccccc-0000-0000-0000-000000000003';
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000d';
select tests.as_user('dddddddd-0000-0000-0000-000000000001');
select tests.invite('return', '00000000-0000-0000-0000-00000000000d', 'caregiver');
reset role;
select tests.as_user('cccccccc-0000-0000-0000-000000000003');
select is(public.accept_invitation(tests.code('return')) ->> 'status', 'ok',
  'a removed member can rejoin with a new invitation');
select is(
  (select role || '/' || status from public.household_members where user_id = auth.uid()),
  'caregiver/active', 'rejoining sets the new role');
reset role;

-- ---------------------------------------------------------------------------
-- Rate limit: 10 wrong attempts an hour (NFR-SEC-8)
-- ---------------------------------------------------------------------------
select tests.as_user('cccccccc-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from generate_series(1, 10) n
   where public.preview_invitation('WRONG' || n) ->> 'status' = 'invalid'),
  10, 'wrong codes are invalid');
select is(public.preview_invitation(tests.code('code-2')), '{"status": "rate_limited"}'::jsonb,
  'after 10 wrong codes in an hour even a right code is refused');
select is(public.accept_invitation(tests.code('code-2')), '{"status": "rate_limited"}'::jsonb,
  'accepting is rate-limited too');
reset role;
update public.invite_attempts set attempted_at = now() - interval '61 minutes'
where user_id = 'cccccccc-0000-0000-0000-000000000004';
select tests.as_user('cccccccc-0000-0000-0000-000000000004');
select is(public.preview_invitation(tests.code('code-2')) ->> 'status', 'seat_limit',
  'the limit lifts after an hour');
select is(public.preview_invitation(tests.code('code-2')) -> 'household_name', null,
  'household details are shown only for an invitation the caller can accept');
reset role;

select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.accept_invitation('ABCDEF')$$, '42501', null,
  'accepting needs a signed-in user');

select * from finish();
rollback;
