import { listSnapshot, partnerChangeAt, PARTNER_ACTIVITY_MS } from '@/features/grocery/shopping';
import type { GroceryItemRow } from '@/features/grocery/tables';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const item = (id: string, over: Partial<GroceryItemRow> = {}): GroceryItemRow => ({
  id,
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: new Date(NOW - 10_000).toISOString(),
  deleted_at: null,
  list_id: 'list',
  ingredient_id: null,
  custom_name: id,
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
  updated_by: 'me',
  ...over,
});
const at = (items: GroceryItemRow[], previous: ReturnType<typeof listSnapshot> | null) =>
  partnerChangeAt({ previous, items, listId: 'list', me: 'me', now: NOW });

describe('partnerChangeAt (FR-LIST-9)', () => {
  it("ignores the member's own changes and other lists", () => {
    expect(
      at([item('a'), item('b', { list_id: 'other', updated_by: 'partner' })], null),
    ).toBeNull();
  });

  it("on first look, counts another member's change from the last minute", () => {
    expect(at([item('a', { updated_by: 'partner' })], null)).toBe(NOW - 10_000);
    const old = new Date(NOW - PARTNER_ACTIVITY_MS - 1).toISOString();
    expect(at([item('a', { updated_by: 'partner', updated_at: old })], null)).toBeNull();
  });

  it('never dates a change later than now, whatever the server clock says', () => {
    const ahead = new Date(NOW + 30_000).toISOString();
    expect(at([item('a', { updated_by: 'partner', updated_at: ahead })], null)).toBe(NOW);
  });

  it('after that, counts a newer version written by another member as changed now', () => {
    const before = listSnapshot([item('a'), item('b')], 'list');
    expect(at([item('a'), item('b', { version: 2, updated_by: 'partner' })], before)).toBe(NOW);
    // The same version again is nothing new.
    const seen = listSnapshot([item('b', { version: 2, updated_by: 'partner' })], 'list');
    expect(at([item('b', { version: 2, updated_by: 'partner' })], seen)).toBeNull();
    // A new item from the partner counts too.
    expect(at([item('c', { updated_by: 'partner' })], before)).toBe(NOW);
  });

  it('ignores old changes a reconnecting device pulls in', () => {
    const before = listSnapshot([item('a')], 'list');
    const old = new Date(NOW - 30 * 60_000).toISOString();
    expect(
      at([item('a', { version: 2, updated_by: 'partner', updated_at: old })], before),
    ).toBeNull();
  });
});
