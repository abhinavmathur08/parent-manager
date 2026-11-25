-- A-05 (FR2-PRIV-2, R2-DOC-4): a deleted household's whole storage folder is purged, not only
-- the folders of the documents it still had. Deleting a document already queues
-- <household>/<document>/ (20261122110000_document_storage.sql); this also queues
-- <household>/ when the household row goes, so a file under it that no live row names (a
-- folder from an earlier purge that failed, or anything the service role left behind) can't
-- outlive the household. The `documents` function's `purge` action walks a household folder's
-- subfolders through the Storage API.

alter table private.storage_purge_queue drop constraint storage_purge_queue_prefix_check;
alter table private.storage_purge_queue add constraint storage_purge_queue_prefix_check
  check (prefix ~ '^[0-9a-f-]{36}/([0-9a-f-]{36}/)?$');

create function private.queue_household_purge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.storage_purge_queue (bucket, prefix, due_at) values
    ('documents', old.id::text || '/', now()),
    -- An upload token handed out just before the deletion lasts up to 2 hours: look again
    -- once it can no longer be used, as for an unfinished upload.
    ('documents', old.id::text || '/', now() + interval '3 hours');
  return null;
end;
$$;

revoke all on function private.queue_household_purge() from public;

create trigger queue_household_purge after delete on public.households
  for each row execute function private.queue_household_purge();
