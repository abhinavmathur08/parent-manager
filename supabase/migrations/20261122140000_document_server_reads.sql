-- V-02.3: only the `documents` Edge Function issues read links (decision D-22; R2-DOC-1,
-- R2-DOC-2, NFR2-SEC-1). Until now the function signed each file as the caller, so the bucket's
-- select policy decided, and a member who could see a document could also call Storage
-- directly and sign a link that lasts longer than 60 seconds. Now clients have no storage
-- policy at all on the bucket: they can't read, list or sign anything in it. The function
-- checks `private.can_read_document` for the caller here, then signs with the service role for
-- `read_seconds` (60).

drop policy "Members read the files of documents they can see" on storage.objects;
drop function private.can_read_document_file(text);

-- Whether `caller` may read `target`'s files: `private.can_read_document` (a parent, or a live
-- share while the caller's seat is active; ready rows only), evaluated as that user, for a
-- document that isn't deleted (tombstones stay visible for sync, not for reading). The
-- caller's claims are set for this transaction only and put back afterwards.
create function public.document_readable(caller uuid, target uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  saved_sub constant text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  saved_claims constant text := coalesce(current_setting('request.jwt.claims', true), '');
  allowed boolean;
begin
  if caller is null or target is null then
    return false;
  end if;
  perform set_config('request.jwt.claim.sub', caller::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', caller)::text, true);
  allowed := private.can_read_document(target)
    and exists (select 1 from public.documents d where d.id = target and d.deleted_at is null);
  perform set_config('request.jwt.claim.sub', saved_sub, true);
  perform set_config('request.jwt.claims', saved_claims, true);
  return coalesce(allowed, false);
end;
$$;

revoke all on function public.document_readable(uuid, uuid) from public, anon, authenticated;
grant execute on function public.document_readable(uuid, uuid) to service_role;
