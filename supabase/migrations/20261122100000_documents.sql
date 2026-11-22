-- V-02.1: the document vault's metadata: documents, document_shares and event_documents, with
-- RLS through private.can_read_document and scoped sync (architecture sections 3.5, 4 and 5;
-- spec FR2-DOC-1, FR2-DOC-6, FR2-DOC-10, R2-ACC-1, R2-DOC-3, NFR2-SEC-1; decisions D-16, D-19).
--
-- Who sees what (spec section 2, rows V1 to V5, D-16):
--   - Parents see, edit and delete every document, share it and attach it to events.
--   - Family members and caregivers see only documents shared with them by name, and only while
--     the household has Premium (private.household_role is already null for them on Free, so a
--     lapse pauses shares and nothing is deleted, FR2-DOC-8).
--   - An attachment never widens access (R2-ACC-1): an event's attachment is visible only to a
--     member who can see both the event and the document.
--
-- Rows are created only by the `documents` Edge Function (V-02.2), as `uploading`, and become
-- visible once their files are stored (`ready`). Clients never insert a document, and never set
-- its file columns. Files never sync; only this metadata does (FR2-DOC-1, NFR2-OFF-1).
--
-- Files only (D-19): the title is the one free-text column (R2-DOC-3); the person tag is a
-- single optional column. There are no structured medical fields.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  -- The parent's choice, the only free text (R2-DOC-3).
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- A fixed identifier; names come from translations (NFR2-L10N-1).
  category text not null check (
    category in ('doc.insurance', 'doc.identity', 'doc.childcare_school', 'doc.medical',
      'doc.household', 'doc.other')
  ),
  -- At most one person (R2-DOC-3). Cleared when the person leaves the household.
  person_id uuid references public.household_people (id) on delete set null,
  expires_on date,
  -- Set by the server from the stored files; clients never change them.
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  -- Files under <household_id>/<document_id>/: scanned pages, or one PDF or image (FR2-DOC-2).
  page_count integer not null check (page_count between 1 and 20),
  size_bytes bigint not null check (size_bytes >= 0),
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  created_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One named family member or caregiver a document is shared with (FR2-DOC-6, D-16). Unsharing
-- tombstones the row; sharing again adds a new one.
create table public.document_shares (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  shared_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- A document attached to an event (FR2-DOC-5). Never widens access (R2-ACC-1).
create table public.event_documents (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index document_shares_document_user_key
  on public.document_shares (document_id, user_id) where deleted_at is null;
create unique index event_documents_event_document_key
  on public.event_documents (event_id, document_id) where deleted_at is null;
create index documents_person_id_idx on public.documents (person_id);
create index documents_created_by_idx on public.documents (created_by);
create index document_shares_user_id_idx on public.document_shares (user_id);
create index document_shares_shared_by_idx on public.document_shares (shared_by);
create index event_documents_document_id_idx on public.event_documents (document_id);

-- ---------------------------------------------------------------------------
-- Visibility (architecture section 4): a parent, or a live share for the caller while their
-- seat is active. Only stored documents count. Tombstones count, so a deletion syncs.
-- ---------------------------------------------------------------------------
create function private.can_read_document(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
    where d.id = target and d.status = 'ready'
      and (private.household_role(d.household_id) = 'parent'
        or (private.household_role(d.household_id) is not null
          and exists (
            select 1 from public.document_shares s
            where s.document_id = d.id and s.user_id = (select auth.uid())
              and s.deleted_at is null)))
  )
$$;

revoke all on function private.can_read_document(uuid) from public;
grant execute on function private.can_read_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Documents: parents edit the title, category, person and expiry, and delete. The file columns
-- and status are the server's. A null caller is the server (the Edge Function's service role).
-- ---------------------------------------------------------------------------
create function private.check_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller constant uuid := (select auth.uid());
  server_columns constant text[] :=
    array['household_id', 'mime', 'page_count', 'size_bytes', 'status', 'created_by'];
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  if caller is not null and pg_trigger_depth() = 1 then
    if private.household_role(new.household_id) is distinct from 'parent' then
      raise exception 'only a parent can change a document' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      raise exception 'documents are added through the documents function' using errcode = '42501';
    end if;
    if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(server_columns) k)
      is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(server_columns) k) then
      raise exception 'a document''s files and status are set by the server' using errcode = '42501';
    end if;
  end if;
  if new.person_id is not null
    and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id)
    and not exists (
      select 1 from public.household_people p
      where p.id = new.person_id and p.household_id = new.household_id and p.deleted_at is null
    ) then
    raise exception 'the person is not in this household' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_document before insert or update on public.documents
  for each row execute function private.check_document();

-- ---------------------------------------------------------------------------
-- Shares and attachments belong to a document (and an event) of their own household, for life.
-- One added offline to a document deleted meanwhile arrives deleted too.
-- ---------------------------------------------------------------------------
create function private.check_document_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller constant uuid := (select auth.uid());
  doc public.documents;
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  -- Refuse anyone but a parent first, so errors never tell them another household's rows exist.
  if pg_trigger_depth() = 1 and private.household_role(new.household_id) is distinct from 'parent' then
    raise exception 'only a parent can share a document' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.document_id <> old.document_id or new.user_id <> old.user_id then
      raise exception 'a share cannot move to another document or member' using errcode = '23514';
    end if;
    new.shared_by := old.shared_by;
    return new;
  end if;

  new.shared_by := caller;
  select * into doc from public.documents d where d.id = new.document_id;
  if doc.id is null or doc.household_id <> new.household_id or doc.status <> 'ready' then
    raise exception 'household_id does not match the document''s household' using errcode = '23514';
  end if;
  if doc.deleted_at is not null then
    new.deleted_at := now();
    return new;
  end if;
  -- Parents already see every document; shares are for family members and caregivers.
  if not exists (
    select 1 from public.household_members m
    where m.household_id = new.household_id and m.user_id = new.user_id
      and m.role in ('family', 'caregiver') and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'documents are shared with family members and caregivers of this household'
      using errcode = '23514', hint = 'documents.share_member';
  end if;
  -- Sharing is Premium (spec section 2, V4; FR2-PAY-2). A constraint error, so the device's
  -- queue refuses the write at once and the app shows the Premium sheet (`document_share`).
  if not private.household_is_premium(new.household_id) then
    raise exception 'sharing documents needs Premium' using errcode = '23514',
      hint = 'documents.share_premium';
  end if;
  return new;
end;
$$;

create function private.check_event_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.events;
  doc public.documents;
begin
  if private.is_erasing() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;
  -- An event or document the caller can't see is refused like another household's, so a wrong
  -- ID never tells them it exists.
  if pg_trigger_depth() = 1 and (private.household_role(new.household_id) is distinct from 'parent'
    or not private.can_read_event(new.event_id) or not private.can_read_document(new.document_id)) then
    raise exception 'only a parent can attach a document' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.event_id <> old.event_id or new.document_id <> old.document_id then
      raise exception 'an attachment cannot move' using errcode = '23514';
    end if;
    return new;
  end if;
  select * into event from public.events e where e.id = new.event_id;
  select * into doc from public.documents d where d.id = new.document_id;
  if event.id is null or doc.id is null or event.household_id <> new.household_id
    or doc.household_id <> new.household_id or doc.status <> 'ready' then
    raise exception 'household_id does not match the event''s or document''s household'
      using errcode = '23514';
  end if;
  if event.deleted_at is not null or doc.deleted_at is not null then
    new.deleted_at := now();
  end if;
  return new;
end;
$$;

create trigger check_document_share before insert or update on public.document_shares
  for each row execute function private.check_document_share();
create trigger check_event_document before insert or update on public.event_documents
  for each row execute function private.check_event_document();

-- Deleting a document removes it from every share and event (FR2-DOC-10), as tombstones that
-- sync. V-02.2 queues its files for purging.
create function private.delete_document_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.document_shares set deleted_at = now()
  where document_id = new.id and deleted_at is null;
  update public.event_documents set deleted_at = now()
  where document_id = new.id and deleted_at is null;
  return null;
end;
$$;

create trigger delete_document_children after update on public.documents
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.delete_document_children();

-- Deleting an event detaches its documents; the documents stay.
create function private.delete_event_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_documents set deleted_at = now()
  where event_id = new.id and deleted_at is null;
  return null;
end;
$$;

create trigger delete_event_documents after update on public.events
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.delete_event_documents();

-- A person removed from the household leaves every document's person tag; the documents stay.
create function private.remove_person_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.documents set person_id = null
  where person_id = new.id and deleted_at is null;
  return null;
end;
$$;

create trigger remove_person_documents
  after update of deleted_at on public.household_people
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.remove_person_documents();

revoke all on function private.check_document() from public;
revoke all on function private.check_document_share() from public;
revoke all on function private.check_event_document() from public;
revoke all on function private.delete_document_children() from public;
revoke all on function private.delete_event_documents() from public;
revoke all on function private.remove_person_documents() from public;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.document_shares enable row level security;
alter table public.event_documents enable row level security;
revoke all on public.documents, public.document_shares, public.event_documents from anon;
-- Only the documents function adds documents (V-02.2).
revoke insert on public.documents from authenticated;

create policy "Parents read every document; others read documents shared with them"
  on public.documents for select to authenticated
  using (private.can_read_document(id));
-- Which columns a parent may change is in private.check_document.
create policy "Parents edit documents"
  on public.documents for update to authenticated
  using (status = 'ready' and private.household_role(household_id) = 'parent')
  with check (status = 'ready' and private.household_role(household_id) = 'parent');

create policy "Parents read every share; members read their own"
  on public.document_shares for select to authenticated
  using (
    private.household_role(household_id) = 'parent'
    or (user_id = (select auth.uid()) and private.household_role(household_id) is not null)
  );
create policy "Parents share documents"
  on public.document_shares for insert to authenticated
  with check (private.household_role(household_id) = 'parent');
create policy "Parents unshare documents"
  on public.document_shares for update to authenticated
  using (private.household_role(household_id) = 'parent')
  with check (private.household_role(household_id) = 'parent');

-- R2-ACC-1: both the event and the document must be visible.
create policy "Members read attachments when they can see the event and the document"
  on public.event_documents for select to authenticated
  using (private.can_read_event(event_id) and private.can_read_document(document_id));
create policy "Parents attach documents"
  on public.event_documents for insert to authenticated
  with check (private.household_role(household_id) = 'parent');
create policy "Parents detach documents"
  on public.event_documents for update to authenticated
  using (private.household_role(household_id) = 'parent')
  with check (private.household_role(household_id) = 'parent');

-- Server timestamps and versions, tombstones, no hard deletes, the pull index and Realtime, and
-- per-row visibility on the device (C-01.3): an unshare or a lapse drops the rows there.
select private.enable_sync('public.documents');
select private.enable_sync('public.document_shares');
select private.enable_sync('public.event_documents');
select private.enable_scoped_sync('public.documents');
select private.enable_scoped_sync('public.document_shares');
select private.enable_scoped_sync('public.event_documents');

-- ---------------------------------------------------------------------------
-- Deletion (A-04.3) and export (A-04.2), FR2-PRIV-1 and FR2-PRIV-2. Files are covered by
-- V-02.2 (storage_purge_queue) and A-05 (the export's documents/ folder).
-- ---------------------------------------------------------------------------
select private.register_for_deletion('public.documents', 'household_id', 'household');
select private.register_for_deletion('public.documents', 'created_by', 'user', 'set_null');
select private.register_for_deletion('public.document_shares', 'household_id', 'household');
select private.register_for_deletion('public.document_shares', 'user_id', 'user');
select private.register_for_deletion('public.document_shares', 'shared_by', 'user', 'set_null');
select private.register_for_deletion('public.event_documents', 'household_id', 'household');

select private.register_for_export('public.documents', 'household', 'household_id');
select private.register_for_export('public.document_shares', 'household', 'household_id');
select private.register_for_export('public.event_documents', 'household', 'household_id');
