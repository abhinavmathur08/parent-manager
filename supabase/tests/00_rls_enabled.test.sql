-- Guard for NFR-SEC-2: every table in the public schema has row-level security enabled.
-- A new table without RLS fails this test, whatever its own tests say.
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select is(
  array(
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by 1
  ),
  array[]::text[],
  'every public table has row-level security enabled'
);

select * from finish();
rollback;
