-- G-09: "don't suggest" for frequently bought suggestions (spec FR-MEM-3 to FR-MEM-5,
-- R-MEM-2, R-MEM-3; architecture sections 3.2, 3.4 and 5).
--
-- Suggestions are worked out on the device from purchase_events, so they work offline. This
-- table only holds the ingredients a household asked not to see for 90 days. One live row per
-- ingredient; hiding it again later updates the same row. The server sets hidden_until, so a
-- device's clock can't hide an item for longer.

create table public.frequent_suggestion_hides (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  ingredient_id text not null references public.ingredients (id) on delete cascade,
  -- Until when the ingredient is left out of suggestions (FR-MEM-5): 90 days from the last hide.
  hidden_until timestamptz not null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index frequent_suggestion_hides_ingredient_key
  on public.frequent_suggestion_hides (household_id, ingredient_id) where deleted_at is null;

create function private.check_frequent_suggestion_hide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_erasing() then
    return new;
  end if;
  -- Refuse non-members before looking at other rows, so the errors below never tell them
  -- anything about another household (RLS checks the row only after this trigger).
  if auth.uid() is not null and private.household_role(new.household_id) is null then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.ingredient_id <> old.ingredient_id then
    raise exception 'a hidden suggestion cannot change ingredient' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.ingredients i
    where i.id = new.ingredient_id
      and (i.household_id is null or i.household_id = new.household_id)
  ) then
    raise exception 'the ingredient belongs to another household' using errcode = '23514';
  end if;
  new.hidden_until := clock_timestamp() + interval '90 days';
  return new;
end;
$$;

revoke all on function private.check_frequent_suggestion_hide() from public;

create trigger check_frequent_suggestion_hide
  before insert or update on public.frequent_suggestion_hides
  for each row execute function private.check_frequent_suggestion_hide();

-- Every member adds list items (spec section 2.2, row 28), so every member can hide a
-- suggestion. Deletes are soft (private.enable_sync).
alter table public.frequent_suggestion_hides enable row level security;
revoke all on public.frequent_suggestion_hides from anon;

create policy "Members can read their household's hidden suggestions"
  on public.frequent_suggestion_hides for select to authenticated
  using (private.household_role(household_id) is not null);
create policy "Members can hide suggestions"
  on public.frequent_suggestion_hides for insert to authenticated
  with check (private.household_role(household_id) is not null);
create policy "Members can change hidden suggestions"
  on public.frequent_suggestion_hides for update to authenticated
  using (private.household_role(household_id) is not null)
  with check (private.household_role(household_id) is not null);

select private.enable_sync('public.frequent_suggestion_hides');

-- Account and household deletion (A-04.3, FR-PRIV-3, FR-PRIV-7).
select private.register_for_deletion('public.frequent_suggestion_hides', 'household_id', 'household');
