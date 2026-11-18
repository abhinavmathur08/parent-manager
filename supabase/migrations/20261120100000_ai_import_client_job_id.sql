-- R-06.1: the app names its import job, so it can pick up the result after leaving the
-- import screen (spec S-20, FR-AI-11). The app makes a UUID, sends it with the import, keeps
-- it on the device, and reads the job row back by ID (its own jobs are readable under RLS).
--
-- ai_import_start gains a job ID argument. The two-argument form stays and makes one up, so
-- nothing that calls it changes.

create function public.ai_import_start(p_user_id uuid, p_input_type text, p_job_id uuid)
returns table (job_id uuid, household_id uuid, locale text, region text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  member record;
  recent integer;
begin
  -- One start at a time per user, so parallel requests can't slip past the hourly limit.
  perform pg_advisory_xact_lock(hashtextextended('ai_import_start:' || p_user_id::text, 0));

  if p_job_id is null or exists (select 1 from public.ai_import_jobs j where j.id = p_job_id) then
    raise exception 'job ID missing or already used' using errcode = 'P0001',
      hint = 'import.invalid_request';
  end if;

  select m.household_id, m.role, h.locale, h.region,
         (m.role = 'parent' or e.tier = 'premium') as has_access
  into member
  from public.household_members m
  join public.households h on h.id = m.household_id
  left join public.household_entitlements e on e.household_id = m.household_id
  where m.user_id = p_user_id
    and m.status = 'active'
    and m.deleted_at is null
    and h.deleted_at is null
  limit 1;

  if member.household_id is null or not member.has_access then
    raise exception 'not a household member' using errcode = 'P0001', hint = 'import.forbidden';
  end if;
  if member.role not in ('parent', 'family') then
    raise exception 'caregivers cannot import' using errcode = 'P0001', hint = 'import.forbidden';
  end if;

  select count(*) into recent
  from public.ai_import_jobs j
  where j.user_id = p_user_id and j.created_at > now() - interval '1 hour';

  if recent >= private.ai_import_limit('hourly_per_member') then
    raise exception 'hourly import limit reached' using errcode = 'P0001',
      hint = 'import.rate_limited';
  end if;

  insert into public.ai_import_jobs (id, household_id, user_id, input_type, locale, region)
  values (p_job_id, member.household_id, p_user_id, p_input_type, member.locale, member.region);

  return query select p_job_id, member.household_id, member.locale, member.region;
end;
$$;

-- The original form now delegates, with a fresh ID.
create or replace function public.ai_import_start(p_user_id uuid, p_input_type text)
returns table (job_id uuid, household_id uuid, locale text, region text)
language sql
security definer
set search_path = ''
as $$
  select * from public.ai_import_start(p_user_id, p_input_type, gen_random_uuid())
$$;

revoke all on function public.ai_import_start(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.ai_import_start(uuid, text, uuid) to service_role;
