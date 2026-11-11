-- H-04.2: leaving a household (FR-HH-8, FR-HH-14), and the caller's membership status so a
-- removed or paused member sees S-35 instead of an empty app.

-- A member who leaves is 'left', so S-35 shows only for people who were removed.
alter table public.household_members drop constraint household_members_status_check;
alter table public.household_members add constraint household_members_status_check
  check (status in ('active', 'removed', 'left'));

-- The caller's membership, including the cases RLS hides from them: 'member' (with access),
-- 'paused' (a family member or caregiver while the household is on Free), 'removed', or
-- 'none'. Returns the household's name for S-35, and whether the caller is its only member
-- (leaving then deletes it, FR-HH-8).
create function public.membership_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  m public.household_members;
  household_name text;
  others int;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select hm.* into m
  from public.household_members hm
  join public.households h on h.id = hm.household_id and h.deleted_at is null
  where hm.user_id = caller and hm.deleted_at is null and hm.status in ('active', 'removed')
  order by (hm.status = 'active') desc, hm.updated_at desc
  limit 1;

  if m.household_id is null then
    return jsonb_build_object('status', 'none');
  end if;

  select h.name into household_name from public.households h where h.id = m.household_id;
  select count(*)::int into others from public.household_members o
  where o.household_id = m.household_id and o.user_id <> caller
    and o.status = 'active' and o.deleted_at is null;

  return jsonb_build_object(
    'status', case
      when m.status = 'removed' then 'removed'
      when private.household_role(m.household_id) is null then 'paused'
      else 'member'
    end,
    'household_id', m.household_id,
    'household_name', household_name,
    'role', m.role,
    'only_member', others = 0);
end;
$$;

-- Leaves the caller's household. The last parent can't leave while others remain: they
-- promote someone or delete the household (FR-HH-14). The only member's leaving deletes
-- the household and all its data (FR-HH-8); the app confirms first. Returns whether it was
-- deleted.
create function public.leave_household(household_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target uuid := household_id;
  my_role text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  perform 1 from public.households h where h.id = target for update;

  -- Not household_role(): a paused member can leave too.
  select m.role into my_role from public.household_members m
  where m.household_id = target and m.user_id = caller
    and m.status = 'active' and m.deleted_at is null;
  if my_role is null then
    raise exception 'not a member' using errcode = 'P0002', hint = 'member.not_found';
  end if;

  if private.count_members(target, 'parent', caller) + private.count_members(target, 'family', caller) = 0 then
    delete from public.households h where h.id = target;
    update public.profiles p set active_household_id = null where p.id = caller;
    return jsonb_build_object('deleted', true);
  end if;

  if my_role = 'parent' and private.count_members(target, 'parent', caller) = 0 then
    raise exception 'the household needs a parent' using errcode = 'P0001',
      hint = 'member.last_parent';
  end if;

  update public.household_members m set status = 'left'
  where m.household_id = target and m.user_id = caller;
  update public.profiles p set active_household_id = null
  where p.id = caller and p.active_household_id = target;
  return jsonb_build_object('deleted', false);
end;
$$;

revoke all on function public.membership_status() from public;
revoke all on function public.leave_household(uuid) from public;
grant execute on function public.membership_status() to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
