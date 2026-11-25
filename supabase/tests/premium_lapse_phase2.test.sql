-- M-04, FR2-DOC-8, FR2-REM-6, FR2-BUSY-5, R2-ACC-2: what a lapse to Free does to Phase 2 data.
-- Nothing is deleted: documents, shares, attachments, reminders and busy days all stay. Every
-- document stays viewable (the documents function's read check) and exportable for parents;
-- shares pause, so the caregiver sees nothing; and they resume with Premium. The per-table
-- checks are in documents_rls, document_storage, events_rls, event_changes and document_expiry;
-- this test holds the whole lapse together.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.as_server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- Live rows of a table in household A, counted as the server.
create function tests.live(table_name text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute format('select count(*)::int from public.%I where household_id = %L and deleted_at is null',
    table_name, '00000000-0000-0000-0000-00000000000a') into n;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A on Premium with a parent and a caregiver.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'lapse-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'lapse-caregiver@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_server();
insert into public.documents (id, household_id, title, category, mime, page_count, size_bytes, status, created_by) values
  ('aaaaaaaa-d0c0-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Insurance card',
   'doc.insurance', 'image/jpeg', 1, 400000, 'ready', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-d0c0-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Birth certificate',
   'doc.identity', 'application/pdf', 1, 900000, 'ready', 'aaaaaaaa-0000-0000-0000-000000000001');

-- On Premium: a shared appointment with three reminders and the insurance card attached and
-- shared with the caregiver, and a published busy day.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at, shared) values
  ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Pediatrician',
   '2026-12-01 15:00+00', '2026-12-01 16:00+00', true);
insert into public.event_reminders (id, household_id, event_id, offset_minutes) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', 1440),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', 60),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001', 15);
insert into public.event_documents (id, household_id, event_id, document_id) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7777-0000-0000-000000000001',
   'aaaaaaaa-d0c0-0000-0000-000000000001');
insert into public.document_shares (id, household_id, document_id, user_id) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-d0c0-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000003');
insert into public.busy_days (id, household_id, date, busy, reason) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-12-01', true, 'dinner');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is((select count(*)::int from public.documents), 1,
  'on Premium the caregiver sees the shared document');

-- ---------------------------------------------------------------------------
-- The lapse
-- ---------------------------------------------------------------------------
select tests.as_server();
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';

-- Nothing is deleted (FR2-DOC-8, FR2-REM-6, FR2-BUSY-5).
select is(tests.live('documents'), 2, 'after a lapse no document is deleted');
select is(tests.live('document_shares'), 1, 'shares are kept, paused');
select is(tests.live('event_documents'), 1, 'attachments are kept');
select is(tests.live('event_reminders'), 3, 'every reminder is kept, the extra ones paused');
select is(tests.live('busy_days'), 1, 'busy days are kept');

-- Every document stays viewable: the documents function signs links when this passes (D-22).
select ok(public.document_readable('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000001')
  and public.document_readable('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000002'),
  'a parent can still open every document');
select ok(not public.document_readable('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-d0c0-0000-0000-000000000001'),
  'the caregiver''s share is paused for reads (R2-ACC-2)');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.documents), 2, 'the parent still lists every document');
select is(
  jsonb_array_length(public.export_household_data('00000000-0000-0000-0000-00000000000a') -> 'tables' -> 'documents'),
  2, 'every document stays in the household export');
select is(
  jsonb_array_length(public.export_household_data('00000000-0000-0000-0000-00000000000a') -> 'tables' -> 'document_shares'),
  1, 'and so do the paused shares');
select is((select count(*)::int from public.busy_days), 1, 'the parent still reads the busy day marker');
select is((select count(*)::int from public.event_reminders), 3, 'the parent still reads every reminder');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty($$select id from public.documents$$, 'the caregiver sees no documents after a lapse');

-- Premium again: the paused share resumes with no new write.
select tests.as_server();
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select array_agg(id) from public.documents),
  array['aaaaaaaa-d0c0-0000-0000-000000000001']::uuid[],
  'with Premium back the caregiver sees the shared document again');
select is((select count(*)::int from public.event_documents), 1,
  'and its attachment on the shared appointment');

select * from finish();
rollback;
