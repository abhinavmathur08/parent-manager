-- M-03: Premium gates and lapse behavior (spec FR-PAY-2, FR-PAY-3, FR-PAY-6, FR-PAY-9,
-- FR-PAY-10, FR-HH-1, FR-AI-9; architecture section 8).
--
-- The Phase 1 gates, all enforced on the server from household_entitlements.tier:
--   - Family and caregiver seats (FR-HH-1): create_invitation, resolve_invitation (pending
--     invitations wait while the household is on Free), change_member_role, and the Premium seat
--     cap (H-03, H-04).
--   - Lapse (FR-PAY-9): private.household_role pauses family members and caregivers while the
--     household is on Free; their membership rows and all data stay.
--   - AI allowance tiers (FR-AI-9): private.ai_monthly_allowance (R-05.1).
--   - Saved templates (FR-PLAN-10, P-05) and history beyond the free window (FR-PAY-6, G-08) use
--     the helpers below.
-- Never gated (FR-PAY-10): allergy profiles and warnings, export, account and household
-- deletion, privacy controls, offline use and core notifications. A pgTAP test fails if any of
-- their functions or policies reads the tier.

-- Whether the household has Premium now: a trial, an active subscription, or one in its billing
-- grace period. Every new gate uses this rather than reading the table itself.
create function private.household_is_premium(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.tier = 'premium' from public.household_entitlements e
     where e.household_id = target),
    false)
$$;

revoke all on function private.household_is_premium(uuid) from public;
grant execute on function private.household_is_premium(uuid) to authenticated;

-- The free history window (FR-PAY-6, decided D-9): the current week and the 4 before it, in the
-- household's timezone and week start. Returns the first day of the oldest week a free
-- household can see. Older plans and lists are kept, not deleted.
create function private.free_history_start(target uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select today - ((extract(isodow from today)::int - h.week_start + 7) % 7) - 28
  from public.households h
  cross join lateral (select (now() at time zone h.timezone)::date as today) d
  where h.id = target
$$;

revoke all on function private.free_history_start(uuid) from public;
grant execute on function private.free_history_start(uuid) to authenticated;

-- Whether the week starting on (or containing) `day` is visible to the household now.
create function private.history_visible(target uuid, day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.household_is_premium(target) or day >= private.free_history_start(target)
$$;

revoke all on function private.history_visible(uuid, date) from public;
grant execute on function private.history_visible(uuid, date) to authenticated;
