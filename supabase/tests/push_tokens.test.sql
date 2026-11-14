-- N-01.1 (FR-NOT-2, NFR-SEC-2): push tokens belong to one user. Users read and delete only
-- their own, write only through register_push_token(), and a token moves to whoever signs in
-- on the device next. Account deletion removes them.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b@example.test', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- Registering
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.register_push_token('ExponentPushToken[device-1]', 'ios')$$,
  'a user registers a token');
select lives_ok(
  $$select public.register_push_token('ExponentPushToken[device-1]', 'ios')$$,
  'registering the same token again refreshes it');
select results_eq(
  $$select token, platform from public.push_tokens$$,
  $$values ('ExponentPushToken[device-1]', 'ios')$$,
  'the user reads their own token, once');
select throws_ok(
  $$select public.register_push_token('not a token', 'ios')$$, '23514', null,
  'a malformed token is refused');
select throws_ok(
  $$select public.register_push_token('ExponentPushToken[device-2]', 'web')$$, '23514', null,
  'an unknown platform is refused');
select throws_ok(
  $$insert into public.push_tokens (token, user_id, platform)
    values ('ExponentPushToken[direct]', 'aaaaaaaa-0000-0000-0000-000000000001', 'ios')$$,
  '42501', null, 'tokens cannot be inserted directly');
select throws_ok(
  $$update public.push_tokens set user_id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  '42501', null, 'tokens cannot be updated directly');

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is_empty($$select token from public.push_tokens$$, 'another user cannot read the token');
select is_empty(
  $$delete from public.push_tokens returning token$$, 'another user cannot delete the token');
select lives_ok(
  $$select public.unregister_push_token('ExponentPushToken[device-1]')$$,
  'unregistering someone else''s token does nothing');
reset role;
select is(
  (select user_id from public.push_tokens where token = 'ExponentPushToken[device-1]'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the token still belongs to its user');

-- A shared device: B signs in and registers the same token, which moves to B.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select public.register_push_token('ExponentPushToken[device-1]', 'android');
reset role;
select is(
  (select user_id from public.push_tokens where token = 'ExponentPushToken[device-1]'),
  'bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'signing in on the device moves the token');

-- ---------------------------------------------------------------------------
-- Sign-out, the per-user cap and anonymous callers
-- ---------------------------------------------------------------------------
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select public.unregister_push_token('ExponentPushToken[device-1]');
select is_empty($$select token from public.push_tokens$$, 'sign-out removes the device''s token');

select public.register_push_token(format('ExponentPushToken[d%s]', n), 'ios')
from generate_series(1, 12) n;
select is((select count(*)::int from public.push_tokens), 10, 'a user keeps at most 10 tokens');
select ok(
  not exists (select 1 from public.push_tokens where token in ('ExponentPushToken[d1]', 'ExponentPushToken[d2]')),
  'the oldest tokens are dropped');

reset role;
set local role anon;
select throws_ok(
  $$select public.register_push_token('ExponentPushToken[anon]', 'ios')$$, '42501', null,
  'anonymous callers cannot register tokens');

-- ---------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------
reset role;
select private.erase_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.push_tokens where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0, 'erasing the user removes their tokens');

select * from finish();
rollback;
