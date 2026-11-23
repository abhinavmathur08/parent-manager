-- V-07 (FR2-DOC-7, FR2-DOC-8, FR2-DOC-11, D-15, D-19): document expiry reminders go to parents
-- of Premium households, 30 and 7 days before, at 09:00 household time, once each, with the
-- category and date only (no category for medical documents), and stop on a lapse.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- An instant today at `hhmm` in New York, and a date `days` from today there.
create function tests.ny(hhmm time) returns timestamptz language sql as $$
  select ((now() at time zone 'America/New_York')::date + hhmm) at time zone 'America/New_York'
$$;
create function tests.ny_date(days integer) returns date language sql as $$
  select (now() at time zone 'America/New_York')::date + days
$$;

-- Household A (Premium): two parents, a family member and a caregiver. Household B (Free): a
-- parent. Both in New York.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a3@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'a4@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b1@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'US', 'en-US', 'us_customary', 'America/New_York', 7);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

-- Ready documents expiring in 30 days (insurance), 7 days (medical), 10 days (identity); one
-- still uploading and one deleted, both in 30 days; and one in household B in 30 days.
insert into public.documents
  (id, household_id, title, category, expires_on, mime, page_count, size_bytes, status, deleted_at)
values
  ('d0c00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Insurance card',
   'doc.insurance', tests.ny_date(30), 'image/jpeg', 1, 1, 'ready', null),
  ('d0c00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Allergy plan',
   'doc.medical', tests.ny_date(7), 'image/jpeg', 1, 1, 'ready', null),
  ('d0c00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Passport',
   'doc.identity', tests.ny_date(10), 'image/jpeg', 1, 1, 'ready', null),
  ('d0c00000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', 'Uploading',
   'doc.other', tests.ny_date(30), 'image/jpeg', 1, 1, 'uploading', null),
  ('d0c00000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', 'Deleted',
   'doc.other', tests.ny_date(30), 'image/jpeg', 1, 1, 'ready', now()),
  ('d0c00000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Car insurance',
   'doc.insurance', tests.ny_date(30), 'image/jpeg', 1, 1, 'ready', null);

-- Members joining queue household-change entries; start from an empty inbox.
delete from public.notifications;

select ok(
  (select p.document_expiry
   from private.notification_prefs_of('aaaaaaaa-0000-0000-0000-000000000001') p),
  'expiry reminders are on by default');

select is(private.enqueue_document_expiry(tests.ny('08:55')), 0, 'nothing before 09:00');
select is(private.enqueue_document_expiry(tests.ny('09:05')), 4,
  'at 09:00 each parent gets one for the 30-day and one for the 7-day document');
select is(private.enqueue_document_expiry(tests.ny('09:10')), 0, 'and only once');
select is(private.enqueue_document_expiry(tests.ny('20:00')), 0, 'and never in the evening');

select is(
  (select count(*)::integer from public.notifications
   where user_id in ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000004')),
  0, 'family members and caregivers get none');
select is(
  (select count(*)::integer from public.notifications where household_id = '00000000-0000-0000-0000-00000000000b'),
  0, 'a Free household gets none (D-15)');

select is(
  (select payload from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and payload ->> 'expires_on' = tests.ny_date(30)::text),
  jsonb_build_object('category', 'doc.insurance', 'expires_on', tests.ny_date(30)),
  'the payload is the category and the date only');
select is(
  (select payload from public.notifications
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and payload ->> 'expires_on' = tests.ny_date(7)::text),
  jsonb_build_object('expires_on', tests.ny_date(7)),
  'a medical document''s reminder has no category (FR2-DOC-11)');
select is_empty(
  $$select id from public.notifications
    where payload::text ~* '(medical|insurance card|allergy|d0c00000)'$$,
  'no title, medical category or document ID in any payload');
select ok(
  (select bool_and(deliver_at is not null) from public.notifications
   where type = 'document_expiring'),
  'each is pushed, after quiet hours');

-- A parent who turned them off gets none.
delete from public.notifications;
insert into public.notification_prefs (user_id, document_expiry)
values ('aaaaaaaa-0000-0000-0000-000000000002', false);
select is(private.enqueue_document_expiry(tests.ny('09:20')), 2,
  'a parent with expiry reminders off gets none');

-- After a lapse, queued reminders aren't pushed and none are queued (FR2-DOC-8).
update public.notifications set deliver_at = now() - interval '1 minute';
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select is_empty($$select id from public.claim_pushes() where type = 'document_expiring'$$,
  'after a lapse, queued expiry reminders are not pushed');
delete from public.notifications;
select is(private.enqueue_document_expiry(tests.ny('09:30')), 0,
  'and none are queued');

select * from finish();
rollback;
