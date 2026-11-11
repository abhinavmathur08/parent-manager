-- H-03.1: create, preview, accept and revoke invitations (FR-HH-1, FR-HH-2, FR-HH-7, FR-HH-9,
-- NFR-SEC-8). The invitations table itself is from H-01.1.
--
-- An invitation has a link token and a 6-character code. Only their SHA-256 hashes are
-- stored. Both are single use and expire after 7 days. Wrong codes and tokens are limited to
-- 10 an hour per user, so preview and accept report failures as a status instead of raising
-- an error, which would roll back the record of the attempt.

-- Nullable because invitations made before this migration have no code.
alter table public.invitations add column code_hash text;

-- Two open invitations can't share a code.
create unique index invitations_open_code_hash_idx on public.invitations (code_hash)
  where accepted_at is null and revoked_at is null;

-- Clients never see the hashes (architecture section 3.4).
revoke select on public.invitations from authenticated;
grant select (
  id, household_id, role, invited_by, email, expires_at, accepted_by, accepted_at, revoked_at,
  created_at, updated_at, deleted_at
) on public.invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Wrong attempts, for the rate limit. Security records about the caller, not household data:
-- they cascade with the account and are read only by the functions below.
-- ---------------------------------------------------------------------------
create table public.invite_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index invite_attempts_user_id_idx on public.invite_attempts (user_id, attempted_at);

alter table public.invite_attempts enable row level security;
revoke all on public.invite_attempts from anon, authenticated;
-- No policies: no client role can read or write it.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.sha256_hex(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(pg_catalog.convert_to(value, 'UTF8')), 'hex')
$$;

-- Uppercase letters and digits without 0, O, 1 or I (FR-HH-2). 32 symbols, so a random
-- byte modulo 32 is unbiased.
create function private.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea := extensions.gen_random_bytes(6);
  code text := '';
begin
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

-- Family member and caregiver seats in a Premium household (spec section 1.3, PROPOSED 6).
create function private.premium_seat_limit()
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::int from public.app_config where key = 'household.premium_seats'),
    6)
$$;

-- Finds the invitation for a code or token and says whether the caller can accept it:
-- ok, invalid, rate_limited, revoked, used, expired, premium_required, already_member,
-- in_other_household or seat_limit. A miss counts towards the caller's limit.
create function private.resolve_invitation(code text, token text)
returns table (invitation_id uuid, status text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  normalized text := upper(regexp_replace(coalesce(code, ''), '\s', '', 'g'));
  inv public.invitations;
  caller_household uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if (
    select count(*) from public.invite_attempts a
    where a.user_id = caller and a.attempted_at > now() - interval '1 hour'
  ) >= 10 then
    return query select null::uuid, 'rate_limited';
    return;
  end if;

  select i.* into inv
  from public.invitations i
  join public.households h on h.id = i.household_id and h.deleted_at is null
  where i.deleted_at is null
    and (
      (normalized <> '' and i.code_hash = private.sha256_hex(normalized))
      or (coalesce(token, '') <> '' and i.token_hash = private.sha256_hex(token))
    )
  order by (i.accepted_at is null and i.revoked_at is null) desc, i.created_at desc
  limit 1;

  if inv.id is null then
    insert into public.invite_attempts (user_id) values (caller);
    return query select null::uuid, 'invalid';
    return;
  end if;

  select m.household_id into caller_household
  from public.household_members m
  where m.user_id = caller and m.status = 'active' and m.deleted_at is null
  limit 1;

  return query select inv.id, case
    when inv.revoked_at is not null then 'revoked'
    when inv.accepted_at is not null then 'used'
    when inv.expires_at <= now() then 'expired'
    when caller_household = inv.household_id then 'already_member'
    when caller_household is not null then 'in_other_household'
    -- Pending family and caregiver invitations wait while the household is on Free.
    when inv.role <> 'parent' and not exists (
      select 1 from public.household_entitlements e
      where e.household_id = inv.household_id and e.tier = 'premium'
    ) then 'premium_required'
    when inv.role = 'parent' and (
      select count(*) from public.household_members m
      where m.household_id = inv.household_id and m.role = 'parent'
        and m.status = 'active' and m.deleted_at is null
    ) >= 2 then 'seat_limit'
    when inv.role <> 'parent' and (
      select count(*) from public.household_members m
      where m.household_id = inv.household_id and m.role <> 'parent'
        and m.status = 'active' and m.deleted_at is null
    ) >= private.premium_seat_limit() then 'seat_limit'
    else 'ok'
  end;
end;
$$;

revoke all on function private.sha256_hex(text) from public;
revoke all on function private.new_invite_code() from public;
revoke all on function private.premium_seat_limit() from public;
revoke all on function private.resolve_invitation(text, text) from public;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- A parent invites someone to a role (FR-HH-1). Returns the code and link token, which are
-- shown once and never stored.
create function public.create_invitation(household_id uuid, role text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target uuid := household_id;
  invite_role text := role;
  code text;
  token text := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  invite public.invitations;
begin
  if private.household_role(target) is distinct from 'parent' then
    raise exception 'only parents can invite' using errcode = '42501';
  end if;

  if invite_role = 'parent' then
    if (
      select count(*) from public.household_members m
      where m.household_id = target and m.role = 'parent'
        and m.status = 'active' and m.deleted_at is null
    ) >= 2 then
      raise exception 'the household has two parents' using errcode = 'P0001',
        hint = 'invite.seat_limit';
    end if;
  elsif invite_role in ('family', 'caregiver') then
    if not exists (
      select 1 from public.household_entitlements e
      where e.household_id = target and e.tier = 'premium'
    ) then
      raise exception 'this role needs Premium' using errcode = 'P0001',
        hint = 'invite.premium_required';
    end if;
  else
    raise exception 'unknown role' using errcode = '22023';
  end if;

  loop
    code := private.new_invite_code();
    exit when not exists (
      select 1 from public.invitations i
      where i.code_hash = private.sha256_hex(code)
        and i.accepted_at is null and i.revoked_at is null
    );
  end loop;

  insert into public.invitations (household_id, role, invited_by, token_hash, code_hash, expires_at)
  values (target, invite_role, (select auth.uid()), private.sha256_hex(token),
    private.sha256_hex(code), now() + interval '7 days')
  returning * into invite;

  return jsonb_build_object(
    'id', invite.id, 'role', invite.role, 'code', code, 'token', token,
    'expires_at', invite.expires_at);
end;
$$;

-- What the join screen shows before accepting (FR-HH-6): the household's name, the inviter's
-- display name and the role, when the invitation can be accepted.
create function public.preview_invitation(code text default null, token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  found record;
  result jsonb;
begin
  select * into found from private.resolve_invitation(code, token);
  result := jsonb_build_object('status', found.status);
  if found.status in ('ok', 'in_other_household') then
    select result || jsonb_build_object(
      'household_name', h.name, 'inviter_name', p.display_name, 'role', i.role,
      'expires_at', i.expires_at)
    into result
    from public.invitations i
    join public.households h on h.id = i.household_id
    left join public.profiles p on p.id = i.invited_by
    where i.id = found.invitation_id;
  end if;
  return result;
end;
$$;

-- Accepts an invitation after the four server checks (FR-HH-7) and makes it the caller's
-- household. Returns the status, and on success the household and role.
create function public.accept_invitation(code text default null, token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  found record;
  invite public.invitations;
begin
  select * into found from private.resolve_invitation(code, token);
  if found.status <> 'ok' then
    return jsonb_build_object('status', found.status);
  end if;

  -- Serialize acceptances into one household, then check again under the lock.
  select i.* into invite from public.invitations i where i.id = found.invitation_id;
  perform 1 from public.households h where h.id = invite.household_id for update;
  perform 1 from public.invitations i where i.id = invite.id for update;
  select * into found from private.resolve_invitation(code, token);
  if found.status <> 'ok' then
    return jsonb_build_object('status', found.status);
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (invite.household_id, caller, invite.role)
  on conflict on constraint household_members_pkey do update
    set role = excluded.role, status = 'active', joined_at = now(), deleted_at = null;

  update public.invitations
  set accepted_by = caller, accepted_at = now()
  where id = invite.id;

  update public.profiles set active_household_id = invite.household_id where id = caller;

  return jsonb_build_object(
    'status', 'ok', 'household_id', invite.household_id, 'role', invite.role,
    'created_at', invite.created_at);
end;
$$;

-- A parent revokes a pending invitation (FR-HH-9).
create function public.revoke_invitation(invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  invite public.invitations;
begin
  select i.* into invite from public.invitations i
  where i.id = invitation_id and i.deleted_at is null
  for update;

  if invite.id is null or private.household_role(invite.household_id) is distinct from 'parent' then
    raise exception 'only parents can revoke' using errcode = '42501';
  end if;
  if invite.accepted_at is not null then
    raise exception 'already accepted' using errcode = 'P0001', hint = 'invite.used';
  end if;

  update public.invitations set revoked_at = coalesce(revoked_at, now()) where id = invite.id;
end;
$$;

revoke all on function public.create_invitation(uuid, text) from public;
revoke all on function public.preview_invitation(text, text) from public;
revoke all on function public.accept_invitation(text, text) from public;
revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.create_invitation(uuid, text) to authenticated;
grant execute on function public.preview_invitation(text, text) to authenticated;
grant execute on function public.accept_invitation(text, text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
