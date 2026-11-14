import { amountBase, planAddItem } from '@/features/grocery/add-item';
import type { GroceryItemRow } from '@/features/grocery/tables';

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const item = (id: string, over: Partial<GroceryItemRow> = {}): GroceryItemRow => ({
  ...base,
  id,
  list_id: 'list',
  ingredient_id: 'ingredient.milk',
  custom_name: null,
  dimension: 'volume',
  quantity_base: 500,
  display_unit_id: null,
  section_id: 'section.dairy',
  origin: 'plan',
  plan_quantity_base: 500,
  user_modified: false,
  plan_changed: false,
  checked: false,
  checked_at: null,
  checked_by: null,
  ...over,
});
const milk = {
  kind: 'ingredient' as const,
  ingredientId: 'ingredient.milk',
  sectionId: 'section.dairy' as const,
};

describe('planAddItem (FR-LIST-6, R-LIST-5)', () => {
  it('merges a catalog item into the generated item, adding the amount and marking it user-modified', () => {
    const result = planAddItem({
      listId: 'list',
      items: [item('gen')],
      choice: milk,
      amount: { quantity: 1, unitId: 'unit.l' },
      newId: 'new',
    });
    expect(result).toEqual({
      kind: 'merge',
      itemId: 'gen',
      op: {
        kind: 'update',
        table: 'grocery_items',
        id: 'gen',
        values: { quantity_base: 1500, user_modified: true },
      },
    });
  });

  it('adds to a manual row of the same ingredient without marking it', () => {
    const result = planAddItem({
      listId: 'list',
      items: [item('man', { origin: 'manual', plan_quantity_base: null })],
      choice: milk,
      amount: { quantity: 250, unitId: 'unit.ml' },
      newId: 'new',
    });
    expect(result).toMatchObject({
      kind: 'merge',
      itemId: 'man',
      op: { values: { quantity_base: 750 } },
    });
  });

  it('prefers the generated item over a manual one', () => {
    const result = planAddItem({
      listId: 'list',
      items: [item('a-manual', { origin: 'manual' }), item('z-gen')],
      choice: milk,
      amount: { quantity: 1, unitId: 'unit.cup_us' },
      newId: 'new',
    });
    expect(result).toMatchObject({ kind: 'merge', itemId: 'z-gen' });
  });

  it('adds a new manual row for a checked item, another dimension, another list or a no-quantity item', () => {
    for (const existing of [
      item('gen', { checked: true }),
      item('gen', { dimension: 'mass' }),
      item('gen', { list_id: 'other' }),
      item('gen', { deleted_at: 'x' }),
      item('gen', { dimension: null, quantity_base: null }),
    ]) {
      const result = planAddItem({
        listId: 'list',
        items: [existing],
        choice: milk,
        amount: { quantity: 1, unitId: 'unit.l' },
        newId: 'new',
      });
      expect(result.kind).toBe('insert');
    }
  });

  it('writes a new manual catalog row with its section and the unit as typed', () => {
    const result = planAddItem({
      listId: 'list',
      items: [],
      choice: { kind: 'ingredient', ingredientId: 'ingredient.diapers', sectionId: 'section.baby' },
      amount: { quantity: 2, unitId: null },
      newId: 'new',
    });
    expect(result).toEqual({
      kind: 'insert',
      op: {
        kind: 'insert',
        table: 'grocery_items',
        id: 'new',
        values: {
          list_id: 'list',
          ingredient_id: 'ingredient.diapers',
          custom_name: null,
          dimension: 'count',
          quantity_base: 2,
          display_unit_id: null,
          section_id: 'section.baby',
          origin: 'manual',
          plan_quantity_base: null,
          user_modified: false,
          plan_changed: false,
          checked: false,
        },
      },
    });
  });

  it('keeps free text as its own row, even with the same name as an item on the list', () => {
    const result = planAddItem({
      listId: 'list',
      items: [
        item('card', { ingredient_id: null, custom_name: 'Birthday card', origin: 'manual' }),
      ],
      choice: { kind: 'text', name: '  Birthday card ', sectionId: 'section.other' },
      amount: null,
      newId: 'new',
    });
    expect(result).toMatchObject({
      kind: 'insert',
      op: {
        values: {
          custom_name: 'Birthday card',
          ingredient_id: null,
          dimension: null,
          quantity_base: null,
        },
      },
    });
  });

  it('changes nothing when an ingredient on the list is added again with no amount', () => {
    expect(
      planAddItem({
        listId: 'list',
        items: [item('gen')],
        choice: milk,
        amount: null,
        newId: 'new',
      }),
    ).toEqual({ kind: 'exists', itemId: 'gen' });
  });
});

describe('amountBase (R-ING-3)', () => {
  it('converts through the unit, and treats no unit as a count', () => {
    expect(amountBase({ quantity: 2, unitId: 'unit.tbsp_au' })).toEqual({
      dimension: 'volume',
      base: 40,
    });
    expect(amountBase({ quantity: 3, unitId: null })).toEqual({ dimension: 'count', base: 3 });
  });
});
