import {
  canEditAmount,
  editAmount,
  editUnits,
  haveId,
  itemSources,
  planHave,
  planItemDelete,
  planItemEdit,
} from '@/features/grocery/detail';
import type { GroceryItemRow, GroceryItemSourceRow } from '@/features/grocery/tables';
import type { PantryItemRow } from '@/features/pantry/tables';

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const item = (over: Partial<GroceryItemRow> = {}): GroceryItemRow => ({
  ...base,
  id: 'milk',
  list_id: 'list',
  ingredient_id: 'ingredient.milk',
  custom_name: null,
  dimension: 'volume',
  quantity_base: 709.764,
  display_unit_id: null,
  section_id: 'section.dairy',
  origin: 'plan',
  plan_quantity_base: 709.764,
  user_modified: false,
  plan_changed: false,
  checked: false,
  checked_at: null,
  checked_by: null,
  ...over,
});

describe('planItemEdit (FR-LIST-7)', () => {
  it('writes a new quantity and unit and marks the item user-modified', () => {
    const result = planItemEdit(item(), {
      amount: { quantity: 1, unitId: 'unit.l' },
      amountEdited: true,
    });
    expect(result).toEqual({
      fields: ['quantity', 'unit'],
      op: {
        kind: 'update',
        table: 'grocery_items',
        id: 'milk',
        values: {
          quantity_base: 1000,
          dimension: 'volume',
          display_unit_id: 'unit.l',
          user_modified: true,
          plan_changed: false,
        },
      },
    });
  });

  it('renames an ingredient item, and an empty name shows the ingredient again', () => {
    expect(
      planItemEdit(item(), { name: 'Oat milk', amount: null, amountEdited: false })?.op,
    ).toMatchObject({
      values: { custom_name: 'Oat milk', user_modified: true },
    });
    expect(
      planItemEdit(item({ custom_name: 'Oat milk' }), {
        name: '  ',
        amount: null,
        amountEdited: false,
      })?.op,
    ).toMatchObject({ values: { custom_name: null } });
  });

  it('keeps a free-text item named', () => {
    const text = item({ ingredient_id: null, custom_name: 'Card', origin: 'manual' });
    expect(planItemEdit(text, { name: '', amount: null, amountEdited: false })).toBeNull();
  });

  it('returns nothing when nothing changed', () => {
    expect(
      planItemEdit(item(), { amount: { quantity: 3, unitId: 'unit.cup_us' }, amountEdited: true }),
    ).toEqual(expect.objectContaining({ fields: ['unit'] }));
    expect(planItemEdit(item(), { amount: null, amountEdited: false })).toBeNull();
  });

  it('never moves a plan item to another dimension', () => {
    expect(
      planItemEdit(item(), { amount: { quantity: 500, unitId: 'unit.g' }, amountEdited: true }),
    ).toBeNull();
  });

  it('lets a manual item change dimension or drop its amount', () => {
    const manual = item({ origin: 'manual', plan_quantity_base: null });
    expect(
      planItemEdit(manual, { amount: { quantity: 2, unitId: null }, amountEdited: true })?.op,
    ).toMatchObject({ values: { quantity_base: 2, dimension: 'count' } });
    expect(planItemEdit(manual, { amount: null, amountEdited: true })?.op).toMatchObject({
      values: { quantity_base: null, dimension: null },
    });
  });
});

describe('edit units', () => {
  it('offers a plan item only units of its own dimension, and none for a count', () => {
    const units = editUnits(item(), 'metric', 'AU');
    expect(units).toContain('unit.tbsp_au');
    expect(units).toContain('unit.l');
    expect(units).not.toContain('unit.g');
    expect(editUnits(item({ dimension: 'count' }), 'metric', 'AU')).toEqual([]);
  });

  it('offers a manual item the household system, without "each"', () => {
    const units = editUnits(item({ origin: 'manual' }), 'us_customary', 'US');
    expect(units).toEqual(expect.arrayContaining(['unit.cup_us', 'unit.oz']));
    expect(units).not.toContain('unit.each');
  });

  it('does not let a plan item with no quantity get one', () => {
    expect(canEditAmount(item({ dimension: null, quantity_base: null }))).toBe(false);
    expect(canEditAmount(item({ origin: 'manual', dimension: null }))).toBe(true);
  });

  it('prefills the amount as the list shows it', () => {
    expect(editAmount(item(), 'us_customary')).toEqual({ quantity: 3, unitId: 'unit.cup_us' });
    expect(editAmount(item({ dimension: 'count', quantity_base: 2.5 }), 'metric')).toEqual({
      quantity: 3,
      unitId: null,
    });
    expect(editAmount(item({ dimension: 'mass', quantity_base: 566.99 }), 'us_customary')).toEqual({
      quantity: 1.25,
      unitId: 'unit.lb',
    });
    expect(editAmount(item({ dimension: null, quantity_base: null }), 'metric')).toBeNull();
  });
});

describe('planItemDelete', () => {
  it('is a tombstone that keeps what the item covered, so the plan respects it', () => {
    expect(planItemDelete(item())).toEqual([
      { kind: 'remove', table: 'grocery_items', id: 'milk' },
    ]);
  });
});

describe('planHave (FR-PAN-4)', () => {
  const pantry = (over: Partial<PantryItemRow>): PantryItemRow => ({
    ...base,
    id: 'p',
    ingredient_id: 'ingredient.milk',
    status: 'have',
    have_week_start: '2026-11-15',
    ...over,
  });

  it('records "have" for the list week and takes the item off as recalculation would', () => {
    expect(
      planHave({ householdId: 'hh', item: item(), weekStart: '2026-11-15', pantry: [] }),
    ).toEqual([
      {
        kind: 'insert',
        table: 'pantry_items',
        id: haveId('hh', 'ingredient.milk', '2026-11-15', 0),
        values: { ingredient_id: 'ingredient.milk', status: 'have', have_week_start: '2026-11-15' },
      },
      { kind: 'update', table: 'grocery_items', id: 'milk', values: { plan_quantity_base: 0 } },
      { kind: 'remove', table: 'grocery_items', id: 'milk' },
    ]);
  });

  it('adds no second "have" for the week, and a new row after an undone one', () => {
    const live = planHave({
      householdId: 'hh',
      item: item(),
      weekStart: '2026-11-15',
      pantry: [pantry({})],
    });
    expect(live.some((op) => op.table === 'pantry_items')).toBe(false);
    const undone = planHave({
      householdId: 'hh',
      item: item(),
      weekStart: '2026-11-15',
      pantry: [pantry({ deleted_at: 'x' }), pantry({ id: 'other', have_week_start: '2026-11-08' })],
    });
    expect(undone[0]).toMatchObject({ id: haveId('hh', 'ingredient.milk', '2026-11-15', 1) });
  });

  it('does nothing for a free-text item', () => {
    expect(
      planHave({
        householdId: 'hh',
        item: item({ ingredient_id: null, custom_name: 'Card' }),
        weekStart: 'w',
        pantry: [],
      }),
    ).toEqual([]);
  });
});

describe('itemSources (FR-LIST-12)', () => {
  const source = (
    id: string,
    entry: string,
    over: Partial<GroceryItemSourceRow> = {},
  ): GroceryItemSourceRow => ({
    ...base,
    id,
    item_id: 'milk',
    plan_entry_id: entry,
    recipe_ingredient_id: `line-${id}`,
    quantity_base: 236.588,
    ...over,
  });
  const entries = [
    {
      id: 'tue',
      date: '2026-11-17',
      slot: 'dinner' as const,
      recipe_id: 'pancakes',
      deleted_at: null,
    },
    { id: 'mon', date: '2026-11-16', slot: 'dinner' as const, recipe_id: 'soup', deleted_at: null },
    {
      id: 'mon-am',
      date: '2026-11-16',
      slot: 'breakfast' as const,
      recipe_id: 'gone',
      deleted_at: null,
    },
    {
      id: 'removed',
      date: '2026-11-16',
      slot: 'lunch' as const,
      recipe_id: 'soup',
      deleted_at: 'x',
    },
  ];
  const recipes = [
    { id: 'pancakes', title: 'Pancakes', deleted_at: null },
    { id: 'soup', title: 'Soup', deleted_at: null },
  ];

  it('lists the planned meals and recipe lines behind an item, by day and slot', () => {
    const result = itemSources(
      'milk',
      [
        source('a', 'tue'),
        source('b', 'mon'),
        source('c', 'mon-am'),
        source('d', 'removed'),
        source('e', 'mon', { deleted_at: 'x' }),
        source('f', 'mon', { item_id: 'other' }),
      ],
      entries,
      recipes,
    );
    expect(result.map((s) => [s.date, s.slot, s.recipeTitle])).toEqual([
      ['2026-11-16', 'breakfast', null],
      ['2026-11-16', 'dinner', 'Soup'],
      ['2026-11-17', 'dinner', 'Pancakes'],
    ]);
  });
});
