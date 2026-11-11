-- R-05.1, FR-AI-9: concurrent reservations can't pass the monthly allowance.
--
-- Unlike the other tests this one commits its fixtures, because the competing requests run
-- on their own connections (dblink) and must see them. Everything it creates is deleted at
-- the end. psql stops at the first error, so everything that can fail runs inside one
-- block that catches errors and reports them as a failed test, and the cleanup still runs.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

insert into auth.users (id, email, aud, role) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'e-parent@example.test', 'authenticated', 'authenticated');
insert into public.households (id, name, region, locale, unit_system, timezone, week_start) values
  ('00000000-0000-0000-0000-00000000000e', 'Household E', 'US', 'en-US', 'us_customary', 'America/Chicago', 7);
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000e', 'eeeeeeee-0000-0000-0000-000000000001', 'parent');
-- The usage row exists, so one connection can hold its lock while the others queue.
insert into public.ai_usage (household_id, period, imports_used)
values ('00000000-0000-0000-0000-00000000000e',
        private.ai_usage_period('00000000-0000-0000-0000-00000000000e'), 0);

create temp table e_jobs (n integer primary key, id uuid not null);
do $$
begin
  for i in 1..8 loop
    insert into e_jobs
    select i, job_id from public.ai_import_start('eeeeeeee-0000-0000-0000-000000000001', 'text');
  end loop;
end;
$$;

create temp table e_results (n integer primary key, reserved boolean);
create temp table e_errors (message text);

do $$
declare
  conninfo text := format('host=%s port=%s dbname=%s user=postgres password=postgres',
    coalesce(host(inet_server_addr()), '127.0.0.1'), coalesce(inet_server_port(), 5432),
    current_database());
  job record;
  got boolean;
begin
  -- The gate: hold the usage row's lock until every request is waiting on it.
  perform extensions.dblink_connect('gate', conninfo);
  perform extensions.dblink_exec('gate', 'begin');
  perform * from extensions.dblink('gate', $q$select 1 from public.ai_usage
    where household_id = '00000000-0000-0000-0000-00000000000e' for update$q$) as t(locked integer);

  for job in select * from e_jobs order by n loop
    perform extensions.dblink_connect('c' || job.n, conninfo);
    perform extensions.dblink_send_query('c' || job.n,
      format('select public.ai_import_reserve(%L)', job.id));
  end loop;

  perform pg_sleep(0.5);
  perform extensions.dblink_exec('gate', 'commit');

  for job in select * from e_jobs order by n loop
    select r into got from extensions.dblink_get_result('c' || job.n) as t(r boolean);
    insert into e_results values (job.n, got);
    perform extensions.dblink_disconnect('c' || job.n);
  end loop;
  perform extensions.dblink_disconnect('gate');
exception when others then
  insert into e_errors values (sqlerrm);
  perform extensions.dblink_disconnect(name)
  from unnest(extensions.dblink_get_connections()) as name;
end;
$$;

select plan(4);

select is_empty('select message from e_errors', 'the concurrent requests ran without errors');

select is(
  (select count(*)::int from e_results where reserved), 5,
  'eight simultaneous requests get exactly the 5 free reservations');
select is(
  (select imports_used from public.ai_usage where household_id = '00000000-0000-0000-0000-00000000000e'),
  5, 'usage stops at the allowance');
select is(
  (select count(*)::int from public.ai_import_jobs
   where household_id = '00000000-0000-0000-0000-00000000000e'
     and status = 'failed' and error_code = 'import.quota_exceeded'),
  3, 'the other 3 fail with import.quota_exceeded');

select * from finish();

delete from public.households where id = '00000000-0000-0000-0000-00000000000e';
delete from auth.users where id = 'eeeeeeee-0000-0000-0000-000000000001';
