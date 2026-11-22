-- V-02.2, FR2-DOC-8, FR2-PAY-2, R2-DOC-1, R2-DOC-2, R2-DOC-4, FR2-PRIV-2, NFR2-SEC-1: the private
-- `documents` bucket lets a member read a file only if they can see its document; nobody writes
-- it directly; the server holds the Free and Premium limits; and every deleted document's
-- folder is queued for purging.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

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

create function tests.readable() returns text[] language sql as $$
  select coalesce(array_agg(name order by name), '{}') from storage.objects where bucket_id = 'documents'
$$;
grant execute on function tests.readable() to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: household A (Premium: parent, family member, caregiver), household B (Free: parent).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a-parent@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'a-family@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'a-caregiver@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b-parent@example.test', 'authenticated', 'authenticated');

insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A', 'US', 'en-US', 'us_customary', 'America/New_York', 7),
  ('00000000-0000-0000-0000-00000000000b', 'Household B', 'GB', 'en-GB', 'metric', 'Europe/London', 1);

insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000002', 'family'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000003', 'caregiver'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent');

update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

insert into public.documents (id, household_id, title, category, mime, page_count, size_bytes, status) values
  ('aaaaaaaa-d0c0-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Insurance card',
   'doc.insurance', 'image/jpeg', 2, 400000, 'ready'),
  ('aaaaaaaa-d0c0-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Birth certificate',
   'doc.identity', 'application/pdf', 1, 900000, 'ready'),
  ('bbbbbbbb-d0c0-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Lease',
   'doc.household', 'application/pdf', 1, 200000, 'ready');

insert into storage.objects (bucket_id, name) values
  ('documents', '00000000-0000-0000-0000-00000000000a/aaaaaaaa-d0c0-0000-0000-000000000001/1.jpg'),
  ('documents', '00000000-0000-0000-0000-00000000000a/aaaaaaaa-d0c0-0000-0000-000000000001/2.jpg'),
  ('documents', '00000000-0000-0000-0000-00000000000a/aaaaaaaa-d0c0-0000-0000-000000000002/1.pdf'),
  ('documents', '00000000-0000-0000-0000-00000000000b/bbbbbbbb-d0c0-0000-0000-000000000001/1.pdf'),
  -- A file whose path names another household than its document's.
  ('documents', '00000000-0000-0000-0000-00000000000b/aaaaaaaa-d0c0-0000-0000-000000000002/1.pdf');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.document_shares (id, household_id, document_id, user_id) values
  ('aaaaaaaa-5ba0-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-d0c0-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------------
-- The bucket and settings (R2-DOC-1, R2-DOC-2, D-17)
-- ---------------------------------------------------------------------------
select tests.as_server();
select is((select public from storage.buckets where id = 'documents'), false, 'the documents bucket is private');
select is(
  (select (value ->> 'read_seconds')::int from public.app_config where key = 'documents.limits'),
  60, 'read links expire after 60 seconds');
select is(
  (select array[(value ->> 'free_documents')::bigint, (value ->> 'premium_bytes')::bigint, (value ->> 'file_bytes')::bigint]
   from public.app_config where key = 'documents.limits'),
  array[25, 2147483648, 10485760]::bigint[], 'Free holds 25 documents, Premium 2 GB, 10 MB a file (D-15)');

-- ---------------------------------------------------------------------------
-- Reading files (spec 3.5 "Caregiver isolation", NFR2-SEC-1, D-22): clients have no policy
-- on the bucket, so they can't read, list or sign a link (Storage signs only rows the caller
-- can select). Only the `documents` function signs, after `document_readable`.
-- ---------------------------------------------------------------------------
select is_empty(
  $$select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%documents%'$$,
  'no storage policy lets clients touch the documents bucket');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is(tests.readable(), '{}'::text[], 'a parent cannot select, list or sign their own files directly');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('documents', '00000000-0000-0000-0000-00000000000a/aaaaaaaa-d0c0-0000-0000-000000000001/3.jpg')$$,
  '42501', null, 'a member cannot upload directly');
select is_empty(
  $$update storage.objects set name = name || 'x' where bucket_id = 'documents' returning id$$,
  'nor rename a file');
-- Storage refuses direct deletes from SQL for everyone; files leave only through the API.
select throws_ok(
  $$delete from storage.objects where bucket_id = 'documents'$$,
  null, null, 'nor delete one');
select throws_ok(
  $$select public.document_readable('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000001')$$,
  '42501', null, 'clients cannot call the function''s read check');

select tests.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select is(tests.readable(), '{}'::text[], 'a caregiver with a share cannot select files directly either');

select tests.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select is(tests.readable(), '{}'::text[], 'nor can another household');

-- The function's check, as the service role.
select tests.as_server();
select is(
  array[
    public.document_readable('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000001'),
    public.document_readable('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000002')],
  array[true, true], 'a parent may read their household''s documents');
select is(
  array[
    public.document_readable('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-d0c0-0000-0000-000000000001'),
    public.document_readable('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-d0c0-0000-0000-000000000002')],
  array[true, false], 'the caregiver may read only the shared document');
select is(
  public.document_readable('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-d0c0-0000-0000-000000000001'),
  false, 'a family member without a share may not');
select is(
  public.document_readable('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000001'),
  false, 'another household may not');
select is(
  coalesce(current_setting('request.jwt.claims', true), ''), '',
  'the check puts the caller''s claims back');

-- A lapse pauses the caregiver's share (FR2-DOC-8).
update public.household_entitlements set tier = 'free'
where household_id = '00000000-0000-0000-0000-00000000000a';
select is(
  public.document_readable('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-d0c0-0000-0000-000000000001'),
  false, 'after a lapse the caregiver may not');
update public.household_entitlements set tier = 'premium'
where household_id = '00000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- Limits held by the server (FR2-DOC-8, FR2-PAY-2)
-- ---------------------------------------------------------------------------
insert into public.documents (id, household_id, title, category, mime, page_count, size_bytes, status)
select gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'Paper ' || n, 'doc.other',
  'image/jpeg', 1, 1000, 'ready'
from generate_series(2, 25) n;
select is(
  (select count(*)::int from public.documents where household_id = '00000000-0000-0000-0000-00000000000b'),
  25, 'a free household holds 25 documents');
select throws_ok(
  $$insert into public.documents (id, household_id, title, category, mime, page_count, size_bytes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'One more', 'doc.other', 'image/jpeg', 1, 1)$$,
  '23514', 'the household has the most documents allowed on Free', 'the 26th is refused');
select throws_ok(
  $$insert into public.documents (id, household_id, title, category, mime, page_count, size_bytes)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Huge', 'doc.other', 'image/jpeg', 20, 2147483648)$$,
  '23514', 'the household''s document storage is full', 'Premium is refused past 2 GB');

select is(
  (public.document_upload_context('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a')
     - 'limits'),
  jsonb_build_object('role', 'caregiver', 'premium', true, 'documents', 2, 'bytes', 1300000),
  'the function sees the caller''s role, the tier and what''s stored');
select tests.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.document_upload_context('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'clients cannot call the function''s RPCs');
select throws_ok($$select * from private.storage_purge_queue$$, '42501', null, 'nor read the purge queue');

-- ---------------------------------------------------------------------------
-- Purging (R2-DOC-4, FR2-PRIV-2)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.documents set deleted_at = now() where id = 'aaaaaaaa-d0c0-0000-0000-000000000002'$$,
  'a parent deletes a document');

select tests.as_server();
select is(
  public.document_readable('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-d0c0-0000-0000-000000000002'),
  false, 'its files can no longer be read');
select is(
  (select array_agg(prefix) from private.storage_purge_queue),
  array['00000000-0000-0000-0000-00000000000a/aaaaaaaa-d0c0-0000-0000-000000000002/'],
  'its folder is queued for purging');

-- An upload that never finished, from 25 hours ago.
insert into public.documents (id, household_id, title, category, mime, page_count, size_bytes, status, created_at) values
  ('aaaaaaaa-d0c0-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000a', 'Abandoned',
   'doc.other', 'image/jpeg', 1, 1000, 'uploading', now() - interval '25 hours');
-- created_at is set by the sync trigger; put it back in the past.
alter table public.documents disable trigger sync_before_update;
update public.documents set created_at = now() - interval '25 hours' where id = 'aaaaaaaa-d0c0-0000-0000-000000000009';
alter table public.documents enable trigger sync_before_update;
select is(public.remove_stale_document_uploads(), 1, 'a stale upload is removed');
select is(
  (select count(*)::int from private.storage_purge_queue
   where prefix like '%aaaaaaaa-d0c0-0000-0000-000000000009/'),
  2, 'and its folder is queued now and again once its upload tokens have expired');

select is(
  (select array_agg(prefix order by prefix) from public.claim_storage_purge(10)),
  array['00000000-0000-0000-0000-00000000000a/aaaaaaaa-d0c0-0000-0000-000000000002/',
        '00000000-0000-0000-0000-00000000000a/aaaaaaaa-d0c0-0000-0000-000000000009/'],
  'a run claims the folders that are due');
select is_empty($$select * from public.claim_storage_purge(10)$$, 'a second run at once claims nothing');

select public.finish_storage_purge(array(select id from private.storage_purge_queue where claimed_at is not null));
select is((select count(*)::int from private.storage_purge_queue), 1, 'finished folders leave the queue');

select * from finish();
rollback;
