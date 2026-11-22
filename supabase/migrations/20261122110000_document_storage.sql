-- V-02.2: the private `documents` bucket, its storage policies, the limits the `documents` Edge
-- Function enforces, and purging files after a deletion (architecture section 3.5; spec
-- FR2-DOC-8, FR2-DOC-10, FR2-PAY-2, R2-DOC-1, R2-DOC-2, R2-DOC-4, FR2-PRIV-2; decisions D-15,
-- D-17). The hosted storage plan (D-21) is still open: this bucket holds test files only until
-- it's decided.
--
-- Files live at <household_id>/<document_id>/<page>.<jpg|png|pdf> (R2-DOC-1). Clients never
-- write to the bucket: the function checks the role and limits, creates the row as `uploading`
-- and hands out signed upload tokens, then checks the stored files and marks the row `ready`.
-- Reading needs a signed link from the function, which it makes as the caller, so the select
-- policy below decides, and it expires after 60 seconds (R2-DOC-2).

-- ---------------------------------------------------------------------------
-- Settings (R2-PAY-1, D-15, D-17): tuned without a release. `file_bytes` must not exceed the
-- bucket's own limit below.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values (
  'documents.limits',
  jsonb_build_object(
    'free_documents', 25,
    'premium_bytes', 2147483648,
    'file_bytes', 10485760,
    'pages', 20,
    'read_seconds', 60,
    'stale_upload_hours', 24)
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The bucket: private, 10 MB a file, the accepted types only (FR2-DOC-2, D-17).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do update set public = false;

-- Storage's own migrations add these columns; the database-only test stack may not have them.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets
    set file_size_limit = 10485760,
        allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
    where id = 'documents';
  end if;
end;
$$;

-- Whether the caller may read a stored file: the path's household and document match a live,
-- stored document they can see (V-02.1). Anything else, including a malformed path, is no.
create function private.can_read_document_file(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := string_to_array(object_name, '/');
  household uuid;
  target uuid;
begin
  if cardinality(parts) <> 3
    or parts[1] !~ '^[0-9a-f-]{36}$' or parts[2] !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  household := parts[1]::uuid;
  target := parts[2]::uuid;
  return exists (
    select 1 from public.documents d
    where d.id = target and d.household_id = household and d.deleted_at is null
  ) and private.can_read_document(target);
end;
$$;

revoke all on function private.can_read_document_file(text) from public;
grant execute on function private.can_read_document_file(text) to authenticated;

-- Reads only. No insert, update or delete policy: clients can't write the bucket at all.
create policy "Members read the files of documents they can see"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and private.can_read_document_file(name));

-- ---------------------------------------------------------------------------
-- The server's limits (FR2-PAY-2): the function checks them first for a clear error; this
-- trigger holds them even for two uploads at once. Free: 25 live documents. Premium: 2 GB.
-- ---------------------------------------------------------------------------
create function private.document_limits()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.value from public.app_config c where c.key = 'documents.limits'),
    '{"free_documents": 25, "premium_bytes": 2147483648}'::jsonb)
$$;

create function private.limit_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits constant jsonb := private.document_limits();
  live_count integer;
  live_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('documents:' || new.household_id::text, 0));
  select count(*), coalesce(sum(d.size_bytes), 0) into live_count, live_bytes
  from public.documents d where d.household_id = new.household_id and d.deleted_at is null;
  if private.household_is_premium(new.household_id) then
    if live_bytes + new.size_bytes > (limits ->> 'premium_bytes')::bigint then
      raise exception 'the household''s document storage is full' using errcode = '23514',
        hint = 'documents.limit';
    end if;
  elsif live_count >= (limits ->> 'free_documents')::integer then
    raise exception 'the household has the most documents allowed on Free' using errcode = '23514',
      hint = 'documents.limit';
  end if;
  return new;
end;
$$;

create trigger limit_documents before insert on public.documents
  for each row execute function private.limit_documents();

revoke all on function private.document_limits() from public;
revoke all on function private.limit_documents() from public;

-- ---------------------------------------------------------------------------
-- The function's view of a household: the caller's role, the tier, what's stored and the limits.
-- ---------------------------------------------------------------------------
create function public.document_upload_context(caller uuid, household uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', (select m.role from public.household_members m
             where m.household_id = household and m.user_id = caller
               and m.status = 'active' and m.deleted_at is null),
    'premium', private.household_is_premium(household),
    'documents', (select count(*) from public.documents d
                  where d.household_id = household and d.deleted_at is null),
    'bytes', (select coalesce(sum(d.size_bytes), 0) from public.documents d
              where d.household_id = household and d.deleted_at is null),
    'limits', private.document_limits())
$$;

-- ---------------------------------------------------------------------------
-- Purging files (R2-DOC-4, FR2-PRIV-2). SQL can't delete storage objects safely, so deleting a
-- document (a tombstone, a stale upload, or a household or account erased) queues its folder,
-- and the function deletes it through the Storage API every hour.
-- ---------------------------------------------------------------------------
create table private.storage_purge_queue (
  id bigint generated always as identity primary key,
  bucket text not null,
  -- <household_id>/<document_id>/: IDs only, no names.
  prefix text not null check (prefix ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/$'),
  due_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0
);

alter table private.storage_purge_queue enable row level security;
revoke all on private.storage_purge_queue from public, anon, authenticated;
create index storage_purge_queue_due_idx on private.storage_purge_queue (due_at);

create function private.queue_document_purge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.documents;
  prefix text;
begin
  if tg_op = 'DELETE' then
    doc := old;
  else
    doc := new;
  end if;
  prefix := doc.household_id::text || '/' || doc.id::text || '/';
  insert into private.storage_purge_queue (bucket, prefix) values ('documents', prefix);
  -- An upload token handed out for an unfinished upload lasts up to 2 hours, so look again
  -- after it can no longer be used.
  if doc.status = 'uploading' then
    insert into private.storage_purge_queue (bucket, prefix, due_at)
    values ('documents', prefix, now() + interval '3 hours');
  end if;
  return null;
end;
$$;

create trigger queue_document_purge after update on public.documents
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.queue_document_purge();
create trigger queue_document_purge_on_delete after delete on public.documents
  for each row when (old.deleted_at is null)
  execute function private.queue_document_purge();

revoke all on function private.queue_document_purge() from public;

-- Removes uploads that never finished (architecture section 3.5). Never seen by clients, so a
-- hard delete; the trigger above queues their folders. Returns how many.
create function public.remove_stale_document_uploads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.documents d
  where d.status = 'uploading'
    and d.created_at < now() - make_interval(
      hours => coalesce((private.document_limits() ->> 'stale_upload_hours')::integer, 24));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Claims due folders for one run. A claim lapses after 10 minutes, so a crashed run is retried.
create function public.claim_storage_purge(batch integer)
returns table (id bigint, bucket text, prefix text)
language sql
security definer
set search_path = ''
as $$
  update private.storage_purge_queue q
  set claimed_at = now(), attempts = q.attempts + 1
  where q.id in (
    select p.id from private.storage_purge_queue p
    where p.due_at <= now() and (p.claimed_at is null or p.claimed_at < now() - interval '10 minutes')
    order by p.due_at
    limit batch
    for update skip locked)
  returning q.id, q.bucket, q.prefix
$$;

create function public.finish_storage_purge(ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.storage_purge_queue q where q.id = any (ids)
$$;

revoke all on function public.document_upload_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_stale_document_uploads() from public, anon, authenticated;
revoke all on function public.claim_storage_purge(integer) from public, anon, authenticated;
revoke all on function public.finish_storage_purge(bigint[]) from public, anon, authenticated;
grant execute on function public.document_upload_context(uuid, uuid) to service_role;
grant execute on function public.remove_stale_document_uploads() to service_role;
grant execute on function public.claim_storage_purge(integer) to service_role;
grant execute on function public.finish_storage_purge(bigint[]) to service_role;

-- Every hour, if folders are due, calls the `documents` function's purge through pg_net. The URL
-- and shared secret live in Vault (`documents_function_url`, `documents_cron_secret`); until the
-- product owner adds them (after D-21), nothing runs.
create function private.dispatch_document_purge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'documents_function_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'documents_cron_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action": "purge"}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.dispatch_document_purge() from public;

select cron.schedule('documents-purge', '17 * * * *', 'select private.dispatch_document_purge()');
