-- N-01.3 (FR-NOT-1, FR-NOT-6, FR-NOT-7, FR-NOT-8, NFR-SEC-2): the inbox is per member and
-- isolated between households; notifications respect each member's switches and quiet
-- hours; household changes reach the other members; the sender claims only due pushes for
-- current members; and only the service role can claim.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Household A in New York (parent, family member), household B in London (parent).
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-joiner@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent');
select is_empty($$select id from public.notifications$$,
  'the first member of a household hears nothing');

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.profiles set locale = 'en-GB' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
-- Quiet hours that never cover "now" for member 1, so their pushes are due at once; member 2
-- keeps quiet hours all day except one minute, so theirs wait.
insert into public.notification_prefs (user_id, quiet_start_minute, quiet_end_minute) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 0, 0);
insert into public.notification_prefs (user_id, quiet_start_minute, quiet_end_minute)
select 'aaaaaaaa-0000-0000-0000-000000000002',
  ((extract(hour from now() at time zone 'America/New_York') * 60
    + extract(minute from now() at time zone 'America/New_York'))::int + 1439) % 1440,
  ((extract(hour from now() at time zone 'America/New_York') * 60
    + extract(minute from now() at time zone 'America/New_York'))::int + 1438) % 1440;

-- ---------------------------------------------------------------------------
-- Household changes (FR-NOT-1)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select user_id, type, payload, deliver_at from public.notifications order by user_id$$,
  $$values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'household_changes', '{"event": "member_joined"}'::jsonb, null::timestamptz)$$,
  'a new member is announced to the others, in the inbox only, without saying who');

update public.household_members set status = 'removed'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and payload ->> 'event' = 'member_left'),
  1, 'a member leaving is announced to those who stay');
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0, 'the member who left is told nothing');
update public.household_members set status = 'active'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and payload ->> 'event' = 'member_joined'),
  2, 'rejoining is announced again');

update public.notification_prefs set household_changes = false
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'family');
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  3, 'a member who turned household changes off hears nothing more (FR-NOT-7)');
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1, 'others still hear it');
update public.notification_prefs set household_changes = true
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.household_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
delete from public.notifications;

-- ---------------------------------------------------------------------------
-- Switches, quiet hours and dedupe (FR-NOT-6, FR-NOT-7)
-- ---------------------------------------------------------------------------
select isnt(
  private.enqueue_notification('aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000000a', 'list_ready', '{"week_start": "2026-11-15"}', 'k1'),
  null, 'a push is created for a member with the type on');
select ok(
  (select deliver_at <= now() from public.notifications where dedupe_key = 'k1'),
  'outside quiet hours it is due at once');
select is(
  private.enqueue_notification('aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000000a', 'list_ready', '{}', 'k1'),
  null, 'the same dedupe key is used once');
select isnt(
  private.enqueue_notification('aaaaaaaa-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-00000000000a', 'list_ready', '{}', 'k1'),
  null, 'dedupe keys are per member');
select is(
  (select deliver_at from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and dedupe_key = 'k1'),
  private.quiet_hours_release(now(), 'America/New_York',
    (select quiet_start_minute from public.notification_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    (select quiet_end_minute from public.notification_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000002')),
  'inside quiet hours it waits until they end, in the household''s timezone');
select ok(
  (select deliver_at > now() from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and dedupe_key = 'k1'),
  'which is later than now');

update public.notification_prefs set plan_week = false
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  private.enqueue_notification('aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000000a', 'plan_week', '{}', 'k2'),
  null, 'turning a type off stops it (FR-NOT-7)');
update public.notification_prefs set plan_week = true
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- The inbox (FR-NOT-8): own rows only, read state, last 50
-- ---------------------------------------------------------------------------
select private.enqueue_notification('bbbbbbbb-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000000b', 'household_changes', '{"event": "member_joined"}');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select results_eq(
  $$select type from public.notifications$$, $$values ('list_ready')$$,
  'a member reads only their own notifications');
select is_empty(
  $$select id from public.notifications where household_id = '00000000-0000-0000-0000-00000000000b'$$,
  'not another household''s');
select throws_ok(
  $$insert into public.notifications (user_id, household_id, type)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'test')$$,
  '42501', null, 'members cannot create notifications');
select throws_ok(
  $$update public.notifications set read_at = now()$$, '42501', null,
  'members cannot update notifications directly');
select throws_ok(
  $$delete from public.notifications$$, '42501', null, 'members cannot delete notifications');
select lives_ok($$select public.mark_notifications_read()$$, 'a member marks everything read');
select ok((select read_at is not null from public.notifications), 'their notification is read');

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.mark_notifications_read(array(select id from public.notifications))$$,
  'another member marks their own read');
select throws_ok($$select * from public.claim_pushes()$$, '42501', null,
  'members cannot claim pushes');
reset role;
select is(
  (select count(*)::int from public.notifications where read_at is null and user_id <> 'bbbbbbbb-0000-0000-0000-000000000001'),
  1, 'marking read touches only the caller''s rows');

select private.enqueue_notification('bbbbbbbb-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000000b', 'household_changes', '{"event": "member_left"}')
from generate_series(1, 55);
select is(
  (select count(*)::int from public.notifications where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  50, 'the inbox keeps the last 50');

-- ---------------------------------------------------------------------------
-- Claiming pushes (service role)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.register_push_token('ExponentPushToken[a-phone]', 'ios');
select public.register_push_token('ExponentPushToken[a-tablet]', 'android');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select public.register_push_token('ExponentPushToken[a2-phone]', 'android');
reset role;

set local role service_role;
select results_eq(
  $$select user_id, type, payload, locale, tokens from public.claim_pushes()$$,
  $$values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'list_ready', '{"week_start": "2026-11-15"}'::jsonb,
    'en-US', array['ExponentPushToken[a-phone]', 'ExponentPushToken[a-tablet]'])$$,
  'the sender gets due pushes with the member''s locale and every device');
select is_empty($$select id from public.claim_pushes()$$,
  'a claimed push is not claimed twice, and one held by quiet hours is not due');
reset role;
select ok(
  (select pushed_at is not null and push_attempts = 1 from public.notifications where dedupe_key = 'k1'
   and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'claiming records the attempt');

set local role service_role;
select public.release_pushes(array(select id from public.notifications where dedupe_key = 'k1'
  and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select is((select count(*)::int from public.claim_pushes()), 1, 'a released push is sent again');
reset role;

-- Queued, then the member turns the type off or leaves before it goes.
select private.enqueue_notification('aaaaaaaa-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000000a', 'plan_week', '{}', 'k3');
update public.notification_prefs set plan_week = false
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select is_empty($$select id from public.claim_pushes()$$,
  'a push for a type turned off since it was queued is dropped');
reset role;
update public.notification_prefs set plan_week = true
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select private.enqueue_notification('aaaaaaaa-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000000a', 'plan_week', '{}', 'k4');
update public.household_members set status = 'left'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select is_empty($$select id from public.claim_pushes()$$,
  'a push for someone who left the household is dropped');
select lives_ok($$select public.drop_push_tokens(array['ExponentPushToken[a-tablet]'])$$,
  'the sender drops a dead token');
reset role;
update public.household_members set status = 'active'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select array_agg(token order by token) from public.push_tokens where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  array['ExponentPushToken[a-phone]'], 'only the dead token went');

-- ---------------------------------------------------------------------------
-- Test notification, dispatch and deletion
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select isnt(public.send_test_notification(), null, 'a member sends themselves a test push');
select is(public.send_test_notification(), null, 'at most one a minute');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'test'),
  1, 'the test goes to the caller only');
set local role anon;
select throws_ok($$select public.send_test_notification()$$, '42501', null,
  'anonymous callers cannot send a test');
reset role;

select lives_ok($$select private.dispatch_pushes()$$,
  'the dispatcher does nothing without its Vault secrets');
select is(
  (select count(*)::int from cron.job where jobname = 'notify-pushes'), 1,
  'the dispatcher runs on a schedule');

-- Export (FR-PRIV-2): the inbox is in the member's account export, not the household's.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select ok(
  jsonb_array_length(public.export_account_data() -> 'tables' -> 'notifications') > 0,
  'a member''s account export includes their inbox');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select ok(
  not (public.export_household_data('00000000-0000-0000-0000-00000000000a') -> 'tables' ? 'notifications'),
  'a parent''s household export does not include other members'' notifications');
reset role;
select private.erase_user('aaaaaaaa-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0, 'erasing a user removes their notifications');

select * from finish();
rollback;
