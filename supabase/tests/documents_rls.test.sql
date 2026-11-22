-- V-02.1, FR2-DOC-1, FR2-DOC-6, FR2-DOC-10, R2-ACC-1, R2-DOC-3, NFR2-SEC-1, D-16, D-19:
-- documents, document_shares and event_documents are isolated per household for every role.
-- Parents see and edit every document; family members and caregivers see only documents shared
-- with them, while the household has Premium; an attachment alone never grants access; clients
-- never add a document or set its files; deleting a document removes its shares and attachments.
begin;
create extension if not exists pgtap with schema extensions;

select plan(78);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the test)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- The documents function's service role: no caller.
create function tests.as_server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- Every read and write a member of household A might try against household B.
create function tests.cannot_reach_household_b(label text)
returns setof text language plpgsql as $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  b_event constant uuid := 'bbbbbbbb-7777-0000-0000-000000000001';
  b_doc constant uuid := 'bbbbbbbb-d0c0-0000-0000-000000000001';
begin
  return next is_empty(
    format('select id from public.documents where household_id = %L', b),
    label || ': cannot read household B''s documents');
  return next is_empty(
    format('select id from public.document_shares where household_id = %L', b),
    label || ': cannot read household B''s shares');
  return next is_empty(
    format('select id from public.event_documents where household_id = %L', b),
    label || ': cannot read household B''s attachments');
  return next is_empty(
    format('update public.documents set title = %L where household_id = %L returning id', 'Hacked', b),
    label || ': cannot edit household B''s documents');
  return next throws_ok(
    format($q$insert into public.document_shares (id, household_id, document_id, user_id)
      values (gen_random_uuid(), %L, %L, 'aaaaaaaa-0000-0000-0000-000000000003')$q$, b, b_doc),
    '42501', null, label || ': cannot share household B''s document');
  return next throws_ok(
    format($q$insert into public.event_documents (id, household_id, event_id, document_id)
      values (gen_random_uuid(), %L, %L, %L)$q$, b, b_event, b_doc),
    '42501', null, label || ': cannot attach household B''s document');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (Premium: parent, family member, caregiver), household B (Free: parent).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'a-other-parent@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'parent'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

insert into public.household_people (id, household_id, display_name, kind, age_band) values
  ('aaaaaaaa-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Baby', 'child', 'infant_0_6m'),
  ('bbbbbbbb-5555-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Sam', 'adult', 'adult');

-- Household B's event and document.
select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at) values
  ('bbbbbbbb-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Dentist',
   '2026-11-24 10:00+00', '2026-11-24 11:00+00');

-- Household A's events: one shared with family and caregivers, one not.
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.events (id, household_id, title, starts_at, ends_at, shared) values
  ('aaaaaaaa-7777-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Pediatrician',
   '2026-11-24 15:00+00', '2026-11-24 16:00+00', true),
  ('aaaaaaaa-7777-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Prenatal',
   '2026-11-25 15:00+00', '2026-11-25 16:00+00', false);

-- Documents are created by the documents function (V-02.2): two stored, one still uploading.
select tests.as_server();
insert into public.documents (id, household_id, title, category, mime, page_count, size_bytes, status, created_by) values
  ('aaaaaaaa-d0c0-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Insurance card',
   'doc.insurance', 'image/jpeg', 2, 400000, 'ready', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-d0c0-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Birth certificate',
   'doc.identity', 'application/pdf', 1, 900000, 'ready', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-d0c0-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Passport',
   'doc.identity', 'image/jpeg', 1, 300000, 'uploading', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-d0c0-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Lease',
   'doc.household', 'application/pdf', 1, 200000, 'ready', 'bbbbbbbb-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Structure (FR2-DOC-1, R2-DOC-3, D-19)
-- ---------------------------------------------------------------------------
select has_trigger('public', 'documents', 'sync_before_update', 'documents sync');
select has_trigger('public', 'document_shares', 'sync_before_update', 'document shares sync');
select has_trigger('public', 'event_documents', 'sync_before_update', 'attachments sync');
select is(
  (select array_agg(table_name::text order by table_name::text) from private.scoped_sync_tables
   where table_name::text in ('documents', 'document_shares', 'event_documents')),
  array['document_shares', 'documents', 'event_documents'],
  'the document tables are scoped, so an unshare leaves the device (C-01.3)');
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns
   where table_schema = 'public' and table_name = 'documents' and data_type = 'text'),
  array['category', 'mime', 'status', 'title'],
  'the title is the only free text on a document; the rest are fixed values (R2-DOC-3, D-19)');

-- ---------------------------------------------------------------------------
-- A parent (spec section 2, V1, V2, V4, V5)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');

select is(
  (select array_agg(id order by id) from public.documents where household_id = '00000000-0000-0000-0000-00000000000a'),
  array['aaaaaaaa-d0c0-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000002']::uuid[],
  'a parent sees every stored document, and none still uploading');
select throws_ok(
  $$insert into public.documents (id, household_id, title, category, mime, page_count, size_bytes, status)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Direct', 'doc.other',
            'image/jpeg', 1, 1, 'ready')$$,
  '42501', null, 'a client cannot add a document directly (FR2-DOC-8: the server refuses it)');
select lives_ok(
  $$update public.documents set title = 'Insurance card (front)', category = 'doc.medical',
      person_id = 'aaaaaaaa-5555-0000-0000-000000000001', expires_on = '2027-06-30'
    where id = 'aaaaaaaa-d0c0-0000-0000-000000000001'$$,
  'a parent changes the title, category, person and expiry');
select throws_ok(
  $$update public.documents set status = 'uploading' where id = 'aaaaaaaa-d0c0-0000-0000-000000000002'$$,
  '42501', null, 'a parent cannot change a document''s status');
select throws_ok(
  $$update public.documents set size_bytes = 1 where id = 'aaaaaaaa-d0c0-0000-0000-000000000002'$$,
  '42501', null, 'nor its size');
select throws_ok(
  $$update public.documents set person_id = 'bbbbbbbb-5555-0000-0000-000000000001'
    where id = 'aaaaaaaa-d0c0-0000-0000-000000000002'$$,
  '23514', null, 'a person from another household is refused');
select throws_ok(
  $$update public.documents set category = 'doc.diagnosis' where id = 'aaaaaaaa-d0c0-0000-0000-000000000002'$$,
  '23514', null, 'an unknown category is refused');
select is_empty(
  $$update public.documents set title = 'Visible' where id = 'aaaaaaaa-d0c0-0000-0000-000000000003' returning id$$,
  'a document still uploading cannot be edited');

select lives_ok(
  $$insert into public.document_shares (id, household_id, document_id, user_id)
    values ('aaaaaaaa-5ba0-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-d0c0-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003')$$,
  'a parent shares the insurance card with the caregiver');
select is(
  (select shared_by from public.document_shares where id = 'aaaaaaaa-5ba0-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the server records who shared it');
select throws_ok(
  $$insert into public.document_shares (id, household_id, document_id, user_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-d0c0-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003')$$,
  '23505', null, 'a document is shared with a member once');
select throws_ok(
  $$insert into public.document_shares (id, household_id, document_id, user_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-d0c0-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004')$$,
  '23514', null, 'sharing with a parent is refused: parents already see everything');
select throws_ok(
  $$insert into public.document_shares (id, household_id, document_id, user_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-d0c0-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001')$$,
  '23514', null, 'sharing with someone outside the household is refused');
select throws_ok(
  $$insert into public.document_shares (id, household_id, document_id, user_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-d0c0-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003')$$,
  '23514', null, 'a document still uploading cannot be shared');

-- Both documents go on the shared appointment; only the insurance card is shared (R2-ACC-1).
select lives_ok(
  $$insert into public.event_documents (id, household_id, event_id, document_id) values
    ('aaaaaaaa-a77a-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000001'),
    ('aaaaaaaa-a77a-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000002'),
    ('aaaaaaaa-a77a-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
     'aaaaaaaa-7777-0000-0000-000000000002', 'aaaaaaaa-d0c0-0000-0000-000000000001')$$,
  'a parent attaches documents to appointments');
select throws_ok(
  $$insert into public.event_documents (id, household_id, event_id, document_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000001')$$,
  '23505', null, 'a document is attached to an event once');
select throws_ok(
  $$insert into public.event_documents (id, household_id, event_id, document_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 'aaaaaaaa-d0c0-0000-0000-000000000003')$$,
  '42501', null, 'a document still uploading cannot be attached');
select throws_ok(
  $$update public.event_documents set document_id = 'aaaaaaaa-d0c0-0000-0000-000000000002'
    where id = 'aaaaaaaa-a77a-0000-0000-000000000003'$$,
  '23514', null, 'an attachment cannot move to another document');

select * from tests.cannot_reach_household_b('parent');

-- ---------------------------------------------------------------------------
-- The caregiver, with one document shared (D-16, R2-ACC-1)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');

select is(
  (select array_agg(id) from public.documents),
  array['aaaaaaaa-d0c0-0000-0000-000000000001']::uuid[],
  'the caregiver sees only the document shared with them');
select is(
  (select array_agg(id) from public.event_documents),
  array['aaaaaaaa-a77a-0000-0000-000000000001']::uuid[],
  'and only that document''s attachment on the shared event');
select is_empty(
  $$select id from public.event_documents where document_id = 'aaaaaaaa-d0c0-0000-0000-000000000002'$$,
  'an attachment on a shared event never shows an unshared document (R2-ACC-1)');
select is_empty(
  $$select id from public.event_documents where event_id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
  'nor does a shared document show the unshared event it is attached to');
select ok(
  not private.can_read_document('aaaaaaaa-d0c0-0000-0000-000000000002'),
  'the attachment alone grants no access to the document');
select is(
  public.visible_ids('documents', '00000000-0000-0000-0000-00000000000a'),
  array['aaaaaaaa-d0c0-0000-0000-000000000001']::uuid[],
  'visible_ids gives the caregiver''s device the shared document only');
select is(
  (select array_agg(id) from public.document_shares),
  array['aaaaaaaa-5ba0-0000-0000-000000000001']::uuid[],
  'the caregiver sees their own share');
select is_empty(
  $$update public.documents set title = 'Mine' where id = 'aaaaaaaa-d0c0-0000-0000-000000000001' returning id$$,
  'the caregiver cannot edit a shared document');
select is_empty(
  $$update public.documents set deleted_at = now() where id = 'aaaaaaaa-d0c0-0000-0000-000000000001' returning id$$,
  'nor delete it');
select throws_ok(
  $$insert into public.document_shares (id, household_id, document_id, user_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-d0c0-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003')$$,
  '42501', null, 'the caregiver cannot share a document with themselves');
select throws_ok(
  $$insert into public.event_documents (id, household_id, event_id, document_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000001')$$,
  '42501', null, 'the caregiver cannot attach documents');
select is_empty(
  $$update public.document_shares set deleted_at = now() returning id$$,
  'the caregiver cannot remove their own share');

select * from tests.cannot_reach_household_b('caregiver');

-- ---------------------------------------------------------------------------
-- The family member, with nothing shared
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000002');

select is_empty($$select id from public.documents$$, 'a family member without a share sees no documents');
select is_empty($$select id from public.event_documents$$, 'nor any attachment, even on a shared event');
select is_empty($$select id from public.document_shares$$, 'nor anyone else''s shares');
select is(
  public.visible_ids('event_documents', '00000000-0000-0000-0000-00000000000a'), '{}'::uuid[],
  'visible_ids gives their device no attachments');

select * from tests.cannot_reach_household_b('family member');

-- ---------------------------------------------------------------------------
-- A lapse to Free pauses shares; nothing is deleted (FR2-DOC-8, FR2-PAY-2)
-- ---------------------------------------------------------------------------
select tests.as_server();
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty($$select id from public.documents$$, 'after a lapse the caregiver sees no documents');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.documents where deleted_at is null), 2,
  'the parent still sees every document');
select throws_ok(
  $$insert into public.document_shares (id, household_id, document_id, user_id)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-d0c0-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002')$$,
  '23514', 'sharing documents needs Premium', 'sharing is refused on Free');

select tests.as_server();
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select array_agg(id) from public.documents),
  array['aaaaaaaa-d0c0-0000-0000-000000000001']::uuid[],
  'the share comes back with Premium');

-- ---------------------------------------------------------------------------
-- Unsharing (FR2-DOC-6, R2-ACC-2)
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$update public.document_shares set deleted_at = now() where id = 'aaaaaaaa-5ba0-0000-0000-000000000001'$$,
  'a parent unshares the document');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty($$select id from public.documents$$, 'the caregiver no longer sees it');
select is_empty($$select id from public.event_documents$$, 'nor its attachment');

-- ---------------------------------------------------------------------------
-- Deleting (FR2-DOC-10) and removing a person
-- ---------------------------------------------------------------------------
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.document_shares (id, household_id, document_id, user_id)
    values ('aaaaaaaa-5ba0-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-d0c0-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003')$$,
  'a parent shares it again, as a new row');
select lives_ok(
  $$update public.documents set deleted_at = now() where id = 'aaaaaaaa-d0c0-0000-0000-000000000001'$$,
  'a parent deletes the document');
select is(
  (select count(*)::int from public.document_shares
   where document_id = 'aaaaaaaa-d0c0-0000-0000-000000000001' and deleted_at is null),
  0, 'it leaves every share');
select is(
  (select count(*)::int from public.event_documents
   where document_id = 'aaaaaaaa-d0c0-0000-0000-000000000001' and deleted_at is null),
  0, 'and every event');
select isnt(
  (select deleted_at from public.documents where id = 'aaaaaaaa-d0c0-0000-0000-000000000001'),
  null, 'its tombstone stays readable, so the deletion syncs');
select lives_ok(
  $$insert into public.event_documents (id, household_id, event_id, document_id)
    values ('aaaaaaaa-a77a-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-7777-0000-0000-000000000002', 'aaaaaaaa-d0c0-0000-0000-000000000001')$$,
  'an attachment made offline to a deleted document is accepted');
select isnt(
  (select deleted_at from public.event_documents where id = 'aaaaaaaa-a77a-0000-0000-000000000009'),
  null, 'and arrives deleted');

select lives_ok(
  $$update public.events set deleted_at = now() where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
  'a parent deletes the appointment');
select is(
  (select count(*)::int from public.event_documents
   where event_id = 'aaaaaaaa-7777-0000-0000-000000000001' and deleted_at is null),
  0, 'its documents are detached');
select is(
  (select count(*)::int from public.documents
   where id = 'aaaaaaaa-d0c0-0000-0000-000000000002' and deleted_at is null),
  1, 'and the documents stay');

select lives_ok(
  $$update public.documents set person_id = 'aaaaaaaa-5555-0000-0000-000000000001'
    where id = 'aaaaaaaa-d0c0-0000-0000-000000000002'$$,
  'a parent tags a person');
select lives_ok(
  $$update public.household_people set deleted_at = now() where id = 'aaaaaaaa-5555-0000-0000-000000000001'$$,
  'a parent removes the person from the household');
select is(
  (select person_id from public.documents where id = 'aaaaaaaa-d0c0-0000-0000-000000000002'),
  null, 'the person leaves the document''s tag; the document stays');

-- ---------------------------------------------------------------------------
-- Export (FR2-PRIV-1)
-- ---------------------------------------------------------------------------
select ok(
  (select (public.export_household_data('00000000-0000-0000-0000-00000000000a') -> 'tables')
     ?& array['documents', 'document_shares', 'event_documents']),
  'the household export has documents, their shares and their attachments');

select * from finish();
rollback;
