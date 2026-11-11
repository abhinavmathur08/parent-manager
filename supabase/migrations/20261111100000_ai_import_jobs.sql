-- R-05.1: AI import jobs, the monthly allowance and the hourly rate limit
-- (architecture section 6; spec FR-AI-8, FR-AI-9, FR-AI-16, NFR-SEC-9; decision D-9).
--
-- Only the import-recipe Edge Function (service role) starts, reserves and finishes jobs.
-- Clients can read their own jobs, to pick up a result after leaving the screen, and their
-- household's usage, to show "used of total" (FR-AI-2).

-- ---------------------------------------------------------------------------
-- Limits: server settings, tuned without a release (D-9).
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values (
  'ai_import.limits',
  jsonb_build_object(
    -- Imports per household per calendar month, in the household's timezone (FR-AI-9).
    'monthly_free', 5,
    -- Premium's fair-use cap (D-9).
    'monthly_premium', 100,
    -- Import attempts per member per rolling hour, on any tier (FR-AI-9).
    'hourly_per_member', 10,
    -- A job still processing after this long has failed: its reservation is released.
    'stale_after_seconds', 120,
    -- Job records are purged after this many days (NFR-SEC-9).
    'retention_days', 30
  )
)
on conflict (key) do nothing;

-- One limit, read fresh each time so a change applies at once.
create function private.ai_import_limit(name text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (c.value ->> name)::integer from public.app_config c where c.key = 'ai_import.limits'
$$;

revoke all on function private.ai_import_limit(text) from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.ai_import_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Set null when the account is deleted; the job stays with the household until purged.
  user_id uuid references auth.users (id) on delete set null,
  input_type text not null check (input_type in ('link', 'text', 'image')),
  -- Copied from the household when the job starts, and sent with every parse (FR-AI-14).
  locale text not null check (locale in ('en-US', 'en-GB', 'en-AU')),
  region text not null check (region in ('US', 'GB', 'AU')),
  status text not null default 'processing'
    check (status in ('processing', 'succeeded', 'failed')),
  -- Where the draft came from: embedded schema.org data (no AI call, free) or the parser.
  source text check (source in ('structured_data', 'parser')),
  -- The month this job holds a reservation in, or null if it holds none (FR-AI-8).
  reserved_period date,
  draft jsonb,
  model text,
  cost_units integer check (cost_units >= 0),
  -- A stable code such as import.parse_failed, never free text.
  error_code text check (error_code ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'processing') = (finished_at is null)),
  check (status <> 'failed' or (error_code is not null and reserved_period is null)),
  check (status <> 'succeeded' or source is not null)
);

create index ai_import_jobs_household_id_idx on public.ai_import_jobs (household_id);
create index ai_import_jobs_user_created_idx on public.ai_import_jobs (user_id, created_at);
create index ai_import_jobs_processing_idx on public.ai_import_jobs (created_at)
  where status = 'processing';

create trigger set_updated_at before update on public.ai_import_jobs
  for each row execute function private.set_updated_at();

create table public.ai_usage (
  household_id uuid not null references public.households (id) on delete cascade,
  -- The first day of the month, in the household's timezone.
  period date not null check (extract(day from period) = 1),
  imports_used integer not null default 0 check (imports_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, period)
);

create trigger set_updated_at before update on public.ai_usage
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.ai_import_jobs enable row level security;
alter table public.ai_usage enable row level security;

revoke all on public.ai_import_jobs, public.ai_usage from anon;
revoke insert, update, delete, truncate on public.ai_import_jobs, public.ai_usage
  from authenticated;

-- Caregivers can't import (FR-AI-16), so they have no jobs to read.
create policy "Importers can read their own import jobs"
  on public.ai_import_jobs for select to authenticated
  using (
    user_id = (select auth.uid())
    and private.household_role(household_id) in ('parent', 'family')
  );

create policy "Members can read their household's AI usage"
  on public.ai_usage for select to authenticated
  using (private.household_role(household_id) is not null);

-- ---------------------------------------------------------------------------
-- Allowance helpers
-- ---------------------------------------------------------------------------

-- The household's current allowance period: the first of this month in its timezone.
create function private.ai_usage_period(target_household_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', now() at time zone h.timezone)::date
  from public.households h
  where h.id = target_household_id
$$;

-- The household's monthly allowance for its current tier. Premium in its grace period
-- keeps Premium's allowance.
create function private.ai_monthly_allowance(target_household_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when e.tier = 'premium' and e.status in ('active', 'grace_period')
      then private.ai_import_limit('monthly_premium')
    else private.ai_import_limit('monthly_free')
  end
  from public.households h
  left join public.household_entitlements e on e.household_id = h.id
  where h.id = target_household_id
$$;

revoke all on function private.ai_usage_period(uuid) from public;
revoke all on function private.ai_monthly_allowance(uuid) from public;

-- ---------------------------------------------------------------------------
-- RPC for the app: the caller's allowance this month (FR-AI-2, FR-AI-10).
-- ---------------------------------------------------------------------------
create function public.ai_import_allowance()
returns table (used integer, allowance integer, period date, resets_on date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target uuid;
  current_period date;
begin
  select m.household_id into target
  from public.household_members m
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.deleted_at is null
  limit 1;

  if target is null or private.household_role(target) is null then
    raise exception 'not a household member' using errcode = '42501';
  end if;

  current_period := private.ai_usage_period(target);
  return query
  select
    coalesce((select u.imports_used from public.ai_usage u
              where u.household_id = target and u.period = current_period), 0),
    private.ai_monthly_allowance(target),
    current_period,
    (current_period + interval '1 month')::date;
end;
$$;

revoke all on function public.ai_import_allowance() from public, anon;
grant execute on function public.ai_import_allowance() to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs for the import-recipe Edge Function (service role only)
-- ---------------------------------------------------------------------------

-- Starts a job for a user: checks they're a parent or family member of an active household
-- (FR-AI-16) and within the hourly rate limit (FR-AI-9), then records the job. Nothing is
-- reserved yet: a link with embedded recipe data never needs a reservation (FR-AI-8).
-- Returns the job with the household's locale and region (FR-AI-14).
create function public.ai_import_start(p_user_id uuid, p_input_type text)
returns table (job_id uuid, household_id uuid, locale text, region text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  member record;
  recent integer;
  new_job uuid;
begin
  -- One start at a time per user, so parallel requests can't slip past the hourly limit.
  perform pg_advisory_xact_lock(hashtextextended('ai_import_start:' || p_user_id::text, 0));

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

  insert into public.ai_import_jobs (household_id, user_id, input_type, locale, region)
  values (member.household_id, p_user_id, p_input_type, member.locale, member.region)
  returning id into new_job;

  return query select new_job, member.household_id, member.locale, member.region;
end;
$$;

-- Reserves one import of the household's monthly allowance for a job, atomically: the
-- conditional upsert takes the usage row's lock, so concurrent reservations queue and
-- none can pass the allowance. Returns false when the allowance is used up, and fails the
-- job with import.quota_exceeded.
create function public.ai_import_reserve(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job record;
  current_period date;
  allowance integer;
  reserved boolean;
begin
  select j.household_id, j.status, j.reserved_period into job
  from public.ai_import_jobs j where j.id = p_job_id
  for update;

  if job.household_id is null or job.status <> 'processing' then
    raise exception 'job is not processing' using errcode = 'P0001', hint = 'import.invalid_job';
  end if;
  if job.reserved_period is not null then
    return true;
  end if;

  current_period := private.ai_usage_period(job.household_id);
  allowance := private.ai_monthly_allowance(job.household_id);

  insert into public.ai_usage as u (household_id, period, imports_used)
  select job.household_id, current_period, 1
  where allowance >= 1
  on conflict (household_id, period) do update
    set imports_used = u.imports_used + 1
    where u.imports_used < allowance
  returning true into reserved;

  if reserved then
    update public.ai_import_jobs set reserved_period = current_period where id = p_job_id;
    return true;
  end if;

  update public.ai_import_jobs
  set status = 'failed', error_code = 'import.quota_exceeded', finished_at = now()
  where id = p_job_id;
  return false;
end;
$$;

-- Gives back a job's reservation, if it holds one. The period is the one reserved in, so a
-- job that fails just after midnight on the 1st releases last month's count.
create function private.ai_import_release(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  held date;
  target uuid;
begin
  select j.reserved_period, j.household_id into held, target
  from public.ai_import_jobs j where j.id = p_job_id
  for update;

  if held is not null then
    update public.ai_import_jobs set reserved_period = null where id = p_job_id;
    update public.ai_usage
    set imports_used = greatest(imports_used - 1, 0)
    where household_id = target and period = held;
  end if;
end;
$$;

revoke all on function private.ai_import_release(uuid) from public;

-- Finishes a processing job. A success keeps its reservation, so it counts (FR-AI-8); a
-- structured-data success never held one. A failure releases any reservation, so failed
-- imports don't count.
create function public.ai_import_finish(
  p_job_id uuid,
  p_status text,
  p_source text default null,
  p_draft jsonb default null,
  p_error_code text default null,
  p_model text default null,
  p_cost_units integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  select j.status into current_status from public.ai_import_jobs j where j.id = p_job_id
  for update;

  if current_status is distinct from 'processing' then
    raise exception 'job is not processing' using errcode = 'P0001', hint = 'import.invalid_job';
  end if;
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid status' using errcode = '22023', hint = 'import.invalid_job';
  end if;

  if p_status = 'failed' then
    perform private.ai_import_release(p_job_id);
  end if;

  update public.ai_import_jobs
  set status = p_status,
      source = case when p_status = 'succeeded' then p_source end,
      draft = case when p_status = 'succeeded' then p_draft end,
      error_code = case when p_status = 'failed' then p_error_code end,
      model = p_model,
      cost_units = p_cost_units,
      finished_at = now()
  where id = p_job_id;
end;
$$;

revoke all on function public.ai_import_start(uuid, text) from public, anon, authenticated;
revoke all on function public.ai_import_reserve(uuid) from public, anon, authenticated;
revoke all on function public.ai_import_finish(uuid, text, text, jsonb, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.ai_import_start(uuid, text) to service_role;
grant execute on function public.ai_import_reserve(uuid) to service_role;
grant execute on function public.ai_import_finish(uuid, text, text, jsonb, text, text, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Housekeeping: fail stale jobs and purge old records (FR-AI-11, NFR-SEC-9).
-- ---------------------------------------------------------------------------

-- A job left processing (the function crashed or was cut off) fails and gives its
-- reservation back. Records older than the retention period are deleted.
create function private.ai_import_housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale uuid;
begin
  for stale in
    select j.id from public.ai_import_jobs j
    where j.status = 'processing'
      and j.created_at < now() - make_interval(secs => private.ai_import_limit('stale_after_seconds'))
    for update skip locked
  loop
    perform private.ai_import_release(stale);
    update public.ai_import_jobs
    set status = 'failed', error_code = 'import.timeout', finished_at = now()
    where id = stale;
  end loop;

  delete from public.ai_import_jobs j
  where j.created_at < now() - make_interval(days => private.ai_import_limit('retention_days'));
end;
$$;

revoke all on function private.ai_import_housekeeping() from public;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'ai-import-housekeeping',
  '*/10 * * * *',
  'select private.ai_import_housekeeping()'
);
