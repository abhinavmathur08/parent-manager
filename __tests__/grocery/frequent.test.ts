import {
  FREQUENT_WINDOW_MS,
  frequentlyBought,
  hideId,
  type FrequentSuggestionHideRow,
} from '@/features/grocery/frequent';
import type { GroceryItemRow, PurchaseEventRow } from '@/features/grocery/tables';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
let n = 0;
const bought = (name: string, daysAgo: number, over: Partial<PurchaseEventRow> = {}) => ({
  ...base,
  id: `e${n++}`,
  list_id: 'old-list',
  item_id: `item-${n}`,
  ingredient_id: `ingredient.${name}`,
  dimension: null,
  quantity_base: null,
  occurred_at: new Date(NOW - daysAgo * DAY).toISOString(),
  source: 'checked_off' as const,
  recorded_by: 'me',
  ...over,
});
const item = (name: string, over: Partial<GroceryItemRow> = {}): GroceryItemRow => ({
  ...base,
  id: name,
  list_id: 'list',
  ingredient_id: `ingredient.${name}`,
  custom_name: null,
  dimension: null,
  quantity_base: null,
  display_unit_id: null,
  section_id: 'section.other',
  origin: 'manual',
  plan_quantity_base: null,
  user_modified: false,
  plan_changed: false,
  checked: false,
  checked_at: null,
  checked_by: null,
  updated_by: null,
  shopped_at: null,
  ...over,
});
const hide = (name: string, untilDays: number): FrequentSuggestionHideRow => ({
  ...base,
  id: `hide-${name}`,
  ingredient_id: `ingredient.${name}`,
  hidden_until: new Date(NOW + untilDays * DAY).toISOString(),
});
const rank = (input: Partial<Parameters<typeof frequentlyBought>[0]>) =>
  frequentlyBought({
    events: [],
    items: [],
    listId: 'list',
    staples: new Set(),
    hides: [],
    now: NOW,
    ...input,
  });

describe('frequentlyBought (FR-MEM-3, R-MEM-2, R-MEM-3)', () => {
  it('suggests bananas bought in each of the last 3 weeks (spec 3.10 acceptance)', () => {
    expect(
      rank({ events: [bought('banana', 1), bought('banana', 8), bought('banana', 15)] }),
    ).toEqual(['ingredient.banana']);
  });

  it('needs two purchases in the last 8 weeks', () => {
    expect(rank({ events: [bought('milk', 1)] })).toEqual([]);
    expect(
      rank({ events: [bought('milk', 1), bought('milk', FREQUENT_WINDOW_MS / DAY + 1)] }),
    ).toEqual([]);
  });

  it('ranks by count, then the most recent purchase, and shows at most 8', () => {
    const events = [
      bought('eggs', 1),
      bought('eggs', 2),
      bought('eggs', 3),
      bought('milk', 10),
      bought('milk', 11),
      bought('bread', 4),
      bought('bread', 5),
    ];
    expect(rank({ events })).toEqual(['ingredient.eggs', 'ingredient.bread', 'ingredient.milk']);
    const many = Array.from({ length: 10 }, (_, i) => [
      bought(`x${i}`, 1),
      bought(`x${i}`, 2),
    ]).flat();
    expect(rank({ events: many })).toHaveLength(8);
  });

  it('leaves out items unchecked on the list, staples and hidden items', () => {
    const events = ['eggs', 'milk', 'salt', 'bread', 'jam'].flatMap((x) => [
      bought(x, 1),
      bought(x, 2),
    ]);
    expect(
      rank({
        events,
        items: [item('eggs'), item('jam', { checked: true })],
        staples: new Set(['ingredient.salt']),
        hides: [hide('milk', 30), hide('bread', -1)],
      }),
    ).toEqual(expect.arrayContaining(['ingredient.bread', 'ingredient.jam']));
    expect(
      rank({
        events,
        items: [item('eggs')],
        staples: new Set(['ingredient.salt']),
        hides: [hide('milk', 30)],
      }),
    ).not.toEqual(expect.arrayContaining(['ingredient.eggs']));
  });

  it('ignores deleted events and free-text items', () => {
    expect(
      rank({
        events: [
          bought('eggs', 1),
          bought('eggs', 2, { deleted_at: '2026-11-17T00:00:00Z' }),
          bought('card', 1, { ingredient_id: null }),
          bought('card', 2, { ingredient_id: null }),
        ],
      }),
    ).toEqual([]);
  });

  it('gives a hidden ingredient the same row ID on every device', () => {
    expect(hideId('hh', 'ingredient.milk', 0)).toBe(hideId('hh', 'ingredient.milk', 0));
  });
});
