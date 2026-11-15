import {
  assumedAtHome,
  insertStable,
  pantryView,
  planAddStaple,
  planRemoveStaple,
  planUndoHave,
  stapleId,
} from '@/features/pantry/pantry';
import type { PantryItemRow } from '@/features/pantry/tables';

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const row = (id: string, over: Partial<PantryItemRow> = {}): PantryItemRow => ({
  ...base,
  id,
  ingredient_id: `ingredient.${id}`,
  status: 'staple',
  have_week_start: null,
  ...over,
});
const names: Record<string, string> = {
  'ingredient.salt': 'Salt',
  'ingredient.flour': 'Flour',
  'ingredient.oil': 'Olive oil',
  'ingredient.milk': 'Milk',
  'ingredient.eggs': 'Eggs',
};
const sections: Record<string, 'section.pantry' | 'section.dairy' | 'section.baking'> = {
  'ingredient.salt': 'section.pantry',
  'ingredient.oil': 'section.pantry',
  'ingredient.flour': 'section.baking',
  'ingredient.milk': 'section.dairy',
};
const nameOf = (id: string) => names[id] ?? id;
const sectionOf = (id: string) => sections[id] ?? ('section.other' as const);

describe('pantryView (S-22, FR-PAN-2, FR-PAN-5)', () => {
  it('lists this week\'s "have" items, then live staples by section and name', () => {
    const view = pantryView({
      rows: [
        row('salt'),
        row('oil'),
        row('flour'),
        row('gone', { ingredient_id: 'ingredient.eggs', deleted_at: '2026-11-01' }),
        row('hidden', { ingredient_id: 'ingredient.milk', status: 'hidden_staple' }),
        row('milk', { status: 'have', have_week_start: '2026-11-15' }),
        row('eggs', { status: 'have', have_week_start: '2026-11-08' }),
      ],
      weekStart: '2026-11-15',
      nameOf,
      sectionOf,
      locale: 'en-US',
    });
    expect(view.have).toEqual([{ rowId: 'milk', ingredientId: 'ingredient.milk', name: 'Milk' }]);
    expect(view.staples.map((s) => [s.sectionId, s.rows.map((r) => r.name)])).toEqual(
      expect.arrayContaining([
        ['section.pantry', ['Olive oil', 'Salt']],
        ['section.baking', ['Flour']],
      ]),
    );
    expect(view.staples).toHaveLength(2);
  });
});

describe('staple writes (FR-PAN-2, R-PAN-1)', () => {
  it('turns a hidden staple back on instead of adding a second row', () => {
    const hidden = row('salt', { status: 'hidden_staple' });
    expect(planAddStaple({ ingredientId: 'ingredient.salt', rows: [hidden] })).toEqual({
      kind: 'revive',
      op: { kind: 'update', table: 'pantry_items', id: 'salt', values: { status: 'staple' } },
    });
  });

  it('adds a new row for a new staple, and nothing for an existing one', () => {
    expect(planAddStaple({ ingredientId: 'ingredient.flour', rows: [row('salt')] })).toEqual({
      kind: 'insert',
      values: { ingredient_id: 'ingredient.flour', status: 'staple' },
    });
    expect(planAddStaple({ ingredientId: 'ingredient.salt', rows: [row('salt')] })).toBeNull();
    // A "have" row for the same ingredient isn't a staple.
    expect(
      planAddStaple({
        ingredientId: 'ingredient.milk',
        rows: [row('milk', { status: 'have', have_week_start: '2026-11-15' })],
      }),
    ).toMatchObject({ kind: 'insert' });
  });

  it('keeps a removed staple as hidden_staple', () => {
    expect(planRemoveStaple(row('salt'))).toEqual([
      { kind: 'update', table: 'pantry_items', id: 'salt', values: { status: 'hidden_staple' } },
    ]);
    expect(planRemoveStaple(row('salt', { status: 'hidden_staple' }))).toEqual([]);
  });

  it('gives two devices the same ID for the same new staple', () => {
    expect(stapleId('hh', 'ingredient.flour', 0)).toBe(stapleId('hh', 'ingredient.flour', 0));
    expect(stapleId('hh', 'ingredient.flour', 0)).not.toBe(stapleId('hh', 'ingredient.flour', 1));
  });
});

describe('planUndoHave (FR-PAN-5)', () => {
  it('tombstones the "have" row, and leaves staples alone', () => {
    const have = row('milk', { status: 'have', have_week_start: '2026-11-15' });
    expect(planUndoHave(have)).toEqual([{ kind: 'remove', table: 'pantry_items', id: 'milk' }]);
    expect(planUndoHave(row('salt'))).toEqual([]);
  });
});

describe('assumedAtHome (FR-PAN-3)', () => {
  it("lists the plan's staples by name, leaving out ones already on the list", () => {
    const result = assumedAtHome({
      staples: ['ingredient.salt', 'ingredient.oil', 'ingredient.flour', 'ingredient.salt'],
      listId: 'list',
      items: [
        { list_id: 'list', ingredient_id: 'ingredient.flour', deleted_at: null },
        { list_id: 'list', ingredient_id: 'ingredient.oil', deleted_at: '2026-11-16' },
        { list_id: 'other', ingredient_id: 'ingredient.salt', deleted_at: null },
      ],
      nameOf,
      locale: 'en-US',
    });
    expect(result).toEqual([
      { ingredientId: 'ingredient.oil', name: 'Olive oil' },
      { ingredientId: 'ingredient.salt', name: 'Salt' },
    ]);
  });
});

describe('insertStable', () => {
  it('skips IDs the device already holds, such as an undone "have"', async () => {
    const held = new Set(['id-0', 'id-1']);
    const insert = jest.fn(async (_table: string, id: string) => {
      if (held.has(id)) throw new Error(`Row already exists: pantry_items ${id}`);
      held.add(id);
    });
    await expect(insertStable({ insert }, 'pantry_items', (i) => `id-${i}`, {})).resolves.toBe(
      'id-2',
    );
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it('passes on other errors', async () => {
    const insert = jest.fn(async () => {
      throw new Error('The local copy is not open yet');
    });
    await expect(insertStable({ insert }, 'pantry_items', (i) => `id-${i}`, {})).rejects.toThrow(
      'not open',
    );
  });
});
