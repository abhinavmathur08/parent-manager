import type { GroceryItemRow, GroceryItemSourceRow } from '@/features/grocery/tables';
import { buildListView, itemQuantity, type ListViewInput } from '@/features/grocery/view';

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
  ingredient_id: `ingredient.${id}`,
  custom_name: null,
  dimension: 'count',
  quantity_base: 2,
  display_unit_id: null,
  section_id: 'section.produce',
  origin: 'plan',
  plan_quantity_base: 2,
  user_modified: false,
  plan_changed: false,
  checked: false,
  checked_at: null,
  checked_by: null,
  ...over,
});
const source = (itemId: string, entryId: string, lineId: string): GroceryItemSourceRow => ({
  ...base,
  id: `${itemId}-${entryId}-${lineId}`,
  item_id: itemId,
  plan_entry_id: entryId,
  recipe_ingredient_id: lineId,
  quantity_base: 1,
});

const input = (over: Partial<ListViewInput>): ListViewInput => ({
  listId: 'list',
  items: [],
  sources: [],
  system: 'us_customary',
  locale: 'en-US',
  nameOf: (i) => i.custom_name ?? (i.ingredient_id ?? '').slice('ingredient.'.length),
  allergensOf: (id) => (id === 'ingredient.milk' ? ['allergen.milk'] : []),
  people: [{ displayName: 'Mia', allergies: ['allergen.milk'] }],
  ...over,
});

describe('buildListView (FR-LIST-4, FR-LIST-5)', () => {
  it('groups by section in the default aisle order, alphabetical within a section', () => {
    const view = buildListView(
      input({
        items: [
          item('milk', {
            section_id: 'section.dairy',
            dimension: 'volume',
            quantity_base: 709.764,
          }),
          item('zucchini'),
          item('apple'),
          item('Banana', {
            ingredient_id: null,
            custom_name: 'banana bread',
            origin: 'manual',
            section_id: 'section.bakery',
          }),
        ],
      }),
    );
    expect(view.sections.map((s) => [s.sectionId, s.rows.map((r) => r.name)])).toEqual([
      ['section.produce', ['apple', 'zucchini']],
      ['section.bakery', ['banana bread']],
      ['section.dairy', ['milk']],
    ]);
    expect(view.sections[2].rows[0].quantity).toEqual([{ value: 3, unitId: 'unit.cup_us' }]);
    expect(view.total).toBe(4);
  });

  it('moves checked items to the cart and leaves out deleted items and other lists', () => {
    const view = buildListView(
      input({
        items: [
          item('egg', { checked: true }),
          item('apple'),
          item('pear', { deleted_at: 'x' }),
          item('kiwi', { list_id: 'other' }),
        ],
      }),
    );
    expect(view.sections.flatMap((s) => s.rows.map((r) => r.id))).toEqual(['apple']);
    expect(view.cart.map((r) => r.id)).toEqual(['egg']);
    expect(view.total).toBe(2);
  });

  it('counts the planned meals behind each item, ignoring removed sources', () => {
    const removed = { ...source('apple', 'e3', 'l3'), deleted_at: 'x' };
    const view = buildListView(
      input({
        items: [item('apple')],
        sources: [
          source('apple', 'e1', 'l1'),
          source('apple', 'e1', 'l2'),
          source('apple', 'e2', 'l1'),
          removed,
        ],
      }),
    );
    expect(view.sections[0].rows[0].meals).toBe(2);
  });

  it('marks items whose ingredient someone is allergic to (R-LIST-8)', () => {
    const view = buildListView(
      input({ items: [item('milk', { section_id: 'section.dairy' }), item('apple')] }),
    );
    const rows = view.sections.flatMap((s) => s.rows);
    expect(rows.find((r) => r.id === 'milk')?.allergens).toEqual([
      { allergen: 'allergen.milk', people: ['Mia'] },
    ]);
    expect(rows.find((r) => r.id === 'apple')?.allergens).toEqual([]);
  });

  it('shows the plan-changed hint only on user-modified items', () => {
    const view = buildListView(
      input({
        items: [
          item('apple', { user_modified: true, plan_changed: true }),
          item('pear', { plan_changed: true }),
        ],
      }),
    );
    expect(view.sections[0].rows.map((r) => r.planChanged)).toEqual([true, false]);
  });

  it('puts an unknown section under "other"', () => {
    const view = buildListView(
      input({ items: [item('apple', { section_id: 'section.nope' as never })] }),
    );
    expect(view.sections[0].sectionId).toBe('section.other');
  });
});

describe('itemQuantity (R-UNIT-3 to R-UNIT-5)', () => {
  it('shows the household unit system by default', () => {
    expect(
      itemQuantity({ dimension: 'mass', quantity_base: 500, display_unit_id: null }, 'metric'),
    ).toEqual([{ value: 500, unitId: 'unit.g' }]);
  });

  it('shows a unit a member chose', () => {
    expect(
      itemQuantity(
        { dimension: 'volume', quantity_base: 1000, display_unit_id: 'unit.l' },
        'us_customary',
      ),
    ).toEqual([{ value: 1, unitId: 'unit.l' }]);
    expect(
      itemQuantity(
        { dimension: 'volume', quantity_base: 354.882, display_unit_id: 'unit.cup_us' },
        'metric',
      ),
    ).toEqual([{ value: 1.5, unitId: 'unit.cup_us' }]);
  });

  it('ignores a chosen unit of another dimension, and shows nothing without a quantity', () => {
    expect(
      itemQuantity({ dimension: 'count', quantity_base: 3, display_unit_id: 'unit.g' }, 'metric'),
    ).toEqual([{ value: 3, unitId: 'unit.each' }]);
    expect(
      itemQuantity({ dimension: null, quantity_base: null, display_unit_id: null }, 'metric'),
    ).toBeNull();
  });
});
