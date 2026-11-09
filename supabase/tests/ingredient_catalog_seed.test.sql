-- R-01.2, FR-PAN-1: the seeded ingredient catalog loads, every ingredient has a section and
-- names in every locale, regional names resolve to one ID, and the default staples are set.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select cmp_ok(
  (select count(*)::int from public.ingredients where household_id is null and deleted_at is null),
  '>=', 400, 'the catalog has about 400 ingredients');
select is_empty(
  $$select i.id from public.ingredients i
    left join public.store_sections s on s.id = i.section_id
    where i.household_id is null and s.id is null$$,
  'every catalog ingredient has a store section');
select is_empty(
  $$select i.id from public.ingredients i
    where i.household_id is null
      and (select count(*) from public.ingredient_names n where n.ingredient_id = i.id) <> 3$$,
  'every catalog ingredient has en-US, en-GB and en-AU names');
select results_eq(
  $$select distinct n.ingredient_id from public.ingredient_names n
    where lower(n.name) in ('courgette', 'zucchini')
       or n.synonyms && array['courgette', 'zucchini']$$,
  array['ingredient.zucchini'],
  '"courgette" and "zucchini" resolve to the same ID');
select results_eq(
  $$select locale, name from public.ingredient_names
    where ingredient_id = 'ingredient.zucchini' order by locale$$,
  $$values ('en-AU', 'zucchini'), ('en-GB', 'courgette'), ('en-US', 'zucchini')$$,
  'each locale shows its own name');
select results_eq(
  $$select id from public.ingredients where is_default_staple order by id$$,
  $$values ('ingredient.black_pepper'), ('ingredient.flour'), ('ingredient.salt'),
    ('ingredient.sugar'), ('ingredient.vegetable_oil'), ('ingredient.water')$$,
  'the default staples are the spec''s list (FR-PAN-1)');
select ok(
  (select allergen_codes @> array['allergen.soy', 'allergen.wheat'] from public.ingredients
   where id = 'ingredient.soy_sauce'),
  'soy sauce carries the soy and wheat allergen codes');
select ok(
  (select density_g_per_ml > 0 from public.ingredients where id = 'ingredient.flour'),
  'flour has a density, so cups and grams can merge');

-- The anonymous role can read the seeded catalog.
select set_config('role', 'anon', true);
select isnt_empty(
  $$select name from public.ingredient_names where ingredient_id = 'ingredient.milk'$$,
  'anon: can read catalog names');
reset role;

select * from finish();
rollback;
