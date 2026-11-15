-- P-04: leftover links point at an earlier entry (spec FR-PLAN-8, R-SERV-3).
--
-- Entry B can be "leftovers of" entry A when A is live and comes before B (an earlier day, or
-- an earlier slot the same day), and A is in B's week or the week before. The app only offers
-- such entries. The week start is a display setting, so the server checks the widest window
-- any week start allows: A at most 13 days before B.
--
-- A link that doesn't hold is dropped rather than refused, so an offline move or link never
-- becomes a refused write (architecture section 5): B becomes an ordinary entry again. This
-- covers moving B before A, moving A after B, and linking to a removed or later entry. Links
-- never point forward, so they can't form a loop.
-- No table or column is added, so the deletion registry and export are unchanged.

create function private.plan_slot_order(slot text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select array_position(array['breakfast', 'lunch', 'dinner', 'snack', 'drink'], slot)
$$;

-- Whether an entry on (b_date, b_slot) may be leftovers of one on (a_date, a_slot).
create function private.leftover_link_holds(a_date date, a_slot text, b_date date, b_slot text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (a_date < b_date
          or (a_date = b_date and private.plan_slot_order(a_slot) < private.plan_slot_order(b_slot)))
    and a_date >= b_date - 13
$$;

-- ---------------------------------------------------------------------------
-- An entry's recipe and leftover link stay inside its own household (P-01.1); an entry for a
-- deleted recipe keeps its title (R-02.3); a leftover link must hold (P-04).
-- ---------------------------------------------------------------------------
create or replace function private.check_plan_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  planned public.recipes;
  source public.plan_entries;
begin
  if new.recipe_id is not null
    and (tg_op = 'INSERT' or new.recipe_id is distinct from old.recipe_id) then
    select * into planned from public.recipes r where r.id = new.recipe_id;
    if planned.id is null or planned.household_id <> new.household_id then
      raise exception 'the recipe belongs to another household' using errcode = '23514';
    end if;
    if planned.deleted_at is not null then
      new.free_text := coalesce(new.free_text, planned.title);
      new.recipe_id := null;
    end if;
  end if;
  if new.leftover_of_entry_id is not null and new.deleted_at is null
    and (tg_op = 'INSERT'
         or new.leftover_of_entry_id is distinct from old.leftover_of_entry_id
         or new.date is distinct from old.date
         or new.slot is distinct from old.slot) then
    select * into source from public.plan_entries e where e.id = new.leftover_of_entry_id;
    if source.id is null or source.household_id <> new.household_id then
      raise exception 'the linked entry belongs to another household' using errcode = '23514';
    end if;
    if source.deleted_at is not null
      or not private.leftover_link_holds(source.date, source.slot, new.date, new.slot) then
      new.leftover_of_entry_id := null;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moving an entry drops the links to it that no longer hold.
-- ---------------------------------------------------------------------------
create function private.drop_broken_leftover_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.plan_entries e
  set leftover_of_entry_id = null
  where e.leftover_of_entry_id = new.id
    and e.household_id = new.household_id
    and e.deleted_at is null
    and not private.leftover_link_holds(new.date, new.slot, e.date, e.slot);
  return null;
end;
$$;

create trigger drop_broken_leftover_links after update on public.plan_entries
  for each row when (old.date is distinct from new.date or old.slot is distinct from new.slot)
  execute function private.drop_broken_leftover_links();

revoke all on function private.plan_slot_order(text) from public;
revoke all on function private.leftover_link_holds(date, text, date, text) from public;
revoke all on function private.drop_broken_leftover_links() from public;
