-- H-04.1: parents change a member's role or remove a member (FR-HH-10, FR-HH-14; spec
-- section 1.3 permissions 9 and 10). Clients can't write household_members directly.

-- Active members of a household with a role, optionally leaving one user out.
create function private.count_members(target uuid, member_role text, except_user uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.household_members m
  where m.household_id = target
    and m.status = 'active' and m.deleted_at is null
    and m.user_id is distinct from except_user
    and case when member_role = 'parent' then m.role = 'parent' else m.role <> 'parent' end
$$;

revoke all on function private.count_members(uuid, text, uuid) from public;

-- Changes a member's role within the seat rules: at most 2 parents, family and caregiver
-- seats need Premium and fit the cap, and the household always keeps a parent.
create function public.change_member_role(household_id uuid, user_id uuid, role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target uuid := household_id;
  member uuid := user_id;
  new_role text := role;
  old_role text;
begin
  if private.household_role(target) is distinct from 'parent' then
    raise exception 'only parents can change roles' using errcode = '42501';
  end if;
  if new_role not in ('parent', 'family', 'caregiver') then
    raise exception 'unknown role' using errcode = '22023';
  end if;

  -- Lock the household so two role changes can't both take the last seat.
  perform 1 from public.households h where h.id = target for update;

  select m.role into old_role from public.household_members m
  where m.household_id = target and m.user_id = member
    and m.status = 'active' and m.deleted_at is null;
  if old_role is null then
    raise exception 'not a member' using errcode = 'P0002', hint = 'member.not_found';
  end if;
  if old_role = new_role then
    return;
  end if;

  if new_role = 'parent' then
    if private.count_members(target, 'parent', member) >= 2 then
      raise exception 'the household has two parents' using errcode = 'P0001',
        hint = 'member.seat_limit';
    end if;
  else
    if not exists (
      select 1 from public.household_entitlements e
      where e.household_id = target and e.tier = 'premium'
    ) then
      raise exception 'this role needs Premium' using errcode = 'P0001',
        hint = 'member.premium_required';
    end if;
    if old_role = 'parent' and private.count_members(target, 'parent', member) = 0 then
      raise exception 'the household needs a parent' using errcode = 'P0001',
        hint = 'member.last_parent';
    end if;
    if old_role = 'parent'
      and private.count_members(target, 'family', member) >= private.premium_seat_limit() then
      raise exception 'no free seats' using errcode = 'P0001', hint = 'member.seat_limit';
    end if;
  end if;

  update public.household_members m set role = new_role
  where m.household_id = target and m.user_id = member;
end;
$$;

-- Removes another member. They lose access at once, because household_role() checks the
-- status; their device clears the household's data when it next syncs. Leaving yourself
-- is leave_household (H-04.2).
create function public.remove_member(household_id uuid, user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target uuid := household_id;
  member uuid := user_id;
begin
  if private.household_role(target) is distinct from 'parent' then
    raise exception 'only parents can remove members' using errcode = '42501';
  end if;
  if member = (select auth.uid()) then
    raise exception 'use leave_household to leave' using errcode = 'P0001',
      hint = 'member.is_self';
  end if;

  update public.household_members m set status = 'removed'
  where m.household_id = target and m.user_id = member
    and m.status = 'active' and m.deleted_at is null;
  if not found then
    raise exception 'not a member' using errcode = 'P0002', hint = 'member.not_found';
  end if;

  update public.profiles p set active_household_id = null
  where p.id = member and p.active_household_id = target;
end;
$$;

revoke all on function public.change_member_role(uuid, uuid, text) from public;
revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
