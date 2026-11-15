-- N-01.1 (FR-NOT-2, architecture "Notifications"): Expo push tokens, one row per device.
--
-- A token belongs to the account signed in on the device. Signing in to another account on
-- the same device moves the token to that account, so writes go through
-- register_push_token(), which can do that, rather than through RLS. Users can read and
-- delete only their own tokens. Rows hold no household data, so they're keyed by user.

create table public.push_tokens (
  token text primary key check (token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "Users can read their own push tokens"
  on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can delete their own push tokens"
  on public.push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

-- No insert or update policies: register_push_token() is the only way in.
revoke insert, update on public.push_tokens from anon, authenticated;

-- A user keeps at most this many devices; registering another drops the least recently seen.
create function private.push_tokens_per_user() returns integer
language sql immutable set search_path = '' as $$ select 10 $$;

-- Saves this device's token for the caller, taking it over from whoever had it before (the
-- device's previous account), and refreshes last_seen_at.
create function public.register_push_token(push_token text, push_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.push_tokens (token, user_id, platform, last_seen_at)
  values (push_token, uid, push_platform, clock_timestamp())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = excluded.last_seen_at;

  delete from public.push_tokens t
  where t.user_id = uid
    and t.token in (
      select token from public.push_tokens
      where user_id = uid
      order by last_seen_at desc, created_at desc
      offset private.push_tokens_per_user()
    );
end;
$$;

-- Removes this device's token at sign-out (FR-AUTH-7). Only the caller's own token goes.
create function public.unregister_push_token(push_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = push_token and user_id = auth.uid();
$$;

revoke all on function private.push_tokens_per_user() from public;
revoke all on function public.register_push_token(text, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

-- Account deletion removes the user's tokens (FR-PRIV-3). The account export (FR-PRIV-2)
-- lists the user's devices, without the token itself: it can address the device.
select private.register_for_deletion('public.push_tokens', 'user_id', 'user');
select private.register_for_export('public.push_tokens', 'user', 'user_id', array['token']);
