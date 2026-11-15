import {
  onListItems,
  planCheckEvent,
  planFinishShopping,
  planUncheckEvent,
  purchaseEventId,
  UNDO_WINDOW_MS,
} from '@/features/grocery/purchases';
import type { GroceryItemRow, PurchaseEventRow } from '@/features/grocery/tables';

const NOW = Date.parse('2026-11-18T12:00:00Z');
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
  quantity_base: 6,
  display_unit_id: null,
  section_id: 'section.dairy',
  origin: 'plan',
  plan_quantity_base: 6,
  user_modified: false,
  plan_changed: false,
  checked: false,
  checked_at: null,
  checked_by: null,
  updated_by: null,
  shopped_at: null,
  ...over,
});
const event = (itemId: string, over: Partial<PurchaseEventRow> = {}): PurchaseEventRow => ({
  ...base,
  id: `event-${itemId}`,
  list_id: 'list',
  item_id: itemId,
  ingredient_id: `ingredient.${itemId}`,
  dimension: 'count',
  quantity_base: 6,
  occurred_at: new Date(NOW - 2 * 60_000).toISOString(),
  source: 'checked_off',
  recorded_by: 'me',
  ...over,
});

describe('purchase events on check-off (FR-LIST-8, FR-MEM-1)', () => {
  it('records the ingredient, base quantity, time and source', () => {
    expect(planCheckEvent(item('eggs'), [], NOW)).toEqual({
      itemId: 'eggs',
      values: {
        list_id: 'list',
        item_id: 'eggs',
        ingredient_id: 'ingredient.eggs',
        dimension: 'count',
        quantity_base: 6,
        occurred_at: '2026-11-18T12:00:00.000Z',
        source: 'checked_off',
      },
    });
  });

  it('records a free-text item by its item ID, with no quantity', () => {
    const card = item('card', {
      ingredient_id: null,
      custom_name: 'Birthday card',
      dimension: null,
      quantity_base: null,
    });
    expect(planCheckEvent(card, [], NOW)?.values).toMatchObject({
      item_id: 'card',
      ingredient_id: null,
      dimension: null,
      quantity_base: null,
    });
  });

  it('records at most one event per item (R-MEM-1)', () => {
    expect(planCheckEvent(item('eggs'), [event('eggs')], NOW)).toBeNull();
    expect(
      planCheckEvent(item('eggs'), [event('eggs', { deleted_at: '2026-11-18T11:00:00Z' })], NOW),
    ).not.toBeNull();
  });

  it('gives both partners the same event ID for an item', () => {
    expect(purchaseEventId('eggs', 0)).toBe(purchaseEventId('eggs', 0));
    expect(purchaseEventId('eggs', 0)).not.toBe(purchaseEventId('eggs', 1));
  });
});

describe('unchecking (FR-LIST-8, R-MEM-1)', () => {
  it('deletes the event within 10 minutes of the purchase', () => {
    expect(planUncheckEvent(item('eggs'), [event('eggs')], NOW)).toEqual([
      { kind: 'remove', table: 'purchase_events', id: 'event-eggs' },
    ]);
  });

  it('keeps the purchase after 10 minutes', () => {
    const old = new Date(NOW - UNDO_WINDOW_MS - 1).toISOString();
    expect(planUncheckEvent(item('eggs'), [event('eggs', { occurred_at: old })], NOW)).toEqual([]);
  });

  it('does nothing without an event', () => {
    expect(planUncheckEvent(item('eggs'), [], NOW)).toEqual([]);
  });
});

describe('finish shopping (FR-LIST-10)', () => {
  const items = [
    item('eggs', { checked: true, checked_by: 'me' }),
    item('milk', { checked: true, checked_by: 'partner' }),
    item('bread'),
    item('old', { checked: true, checked_by: 'me', shopped_at: '2026-11-17T10:00:00Z' }),
    item('gone', { checked: true, deleted_at: '2026-11-17T10:00:00Z' }),
    item('elsewhere', { list_id: 'other', checked: true }),
  ];

  it('records events only for checked items without one, and moves them to history', () => {
    const plan = planFinishShopping({ listId: 'list', items, events: [event('eggs')], now: NOW });
    expect(plan.events.map((e) => [e.itemId, e.values.source])).toEqual([['milk', 'confirmed']]);
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        table: 'grocery_items',
        id: 'eggs',
        values: { shopped_at: '2026-11-18T12:00:00.000Z' },
      },
      {
        kind: 'update',
        table: 'grocery_items',
        id: 'milk',
        values: { shopped_at: '2026-11-18T12:00:00.000Z' },
      },
    ]);
    expect(plan).toMatchObject({ checkedCount: 2, uncheckedCount: 1, membersWhoChecked: 2 });
  });

  it('keeps unchecked items on the list', () => {
    const plan = planFinishShopping({ listId: 'list', items, events: [], now: NOW });
    expect(plan.ops.map((op) => op.id)).not.toContain('bread');
    expect(onListItems(items, 'list').map((i) => i.id)).toEqual(['eggs', 'milk', 'bread']);
  });
});
