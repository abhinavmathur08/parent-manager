-- Two-device harness only (H-06.3): a throwaway synced table. NOT a migration. CI applies it
-- to a disposable local stack after the real migrations, so the harness proves the rules
-- any feature table gets from private.enable_sync().
create table public.harness_items (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by uuid,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.harness_items enable row level security;
revoke all on public.harness_items from anon;

create policy "Members read" on public.harness_items for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members insert" on public.harness_items for insert to authenticated
  with check (private.household_role(household_id) is not null);
create policy "Members update" on public.harness_items for update to authenticated
  using (private.household_role(household_id) is not null)
  with check (private.household_role(household_id) is not null);

select private.enable_sync('public.harness_items', array['checked']);
