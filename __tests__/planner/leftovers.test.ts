import {
  canLink,
  earliestLinkDate,
  isEarlier,
  leftoverCandidates,
  leftoverSource,
  linksBrokenByMove,
} from '@/features/planner/leftovers';
import type { PlanEntryRow, Slot } from '@/features/planner/tables';

const entry = (
  id: string,
  date: string,
  slot: Slot,
  over: Partial<PlanEntryRow> = {},
): PlanEntryRow => ({
  id,
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
  date,
  slot,
  position: 0,
  recipe_id: null,
  free_text: id,
  servings: 2,
  leftover_of_entry_id: null,
  ...over,
});

describe('leftover links (P-04, FR-PLAN-8, R-SERV-3)', () => {
  it('orders entries by day, then slot', () => {
    expect(
      isEarlier(entry('a', '2026-11-16', 'dinner'), entry('b', '2026-11-17', 'breakfast')),
    ).toBe(true);
    expect(isEarlier(entry('a', '2026-11-16', 'lunch'), entry('b', '2026-11-16', 'dinner'))).toBe(
      true,
    );
    expect(isEarlier(entry('a', '2026-11-16', 'dinner'), entry('b', '2026-11-16', 'dinner'))).toBe(
      false,
    );
    expect(isEarlier(entry('a', '2026-11-16', 'dinner'), entry('b', '2026-11-16', 'lunch'))).toBe(
      false,
    );
  });

  it('reaches back to the start of the week before, for either week start', () => {
    expect(earliestLinkDate('2026-11-17', 1)).toBe('2026-11-09'); // Tuesday; weeks start Monday
    expect(earliestLinkDate('2026-11-17', 7)).toBe('2026-11-08'); // weeks start Sunday
    expect(earliestLinkDate('2026-11-15', 7)).toBe('2026-11-08');
  });

  it("can't point at itself, a later or removed entry, or one two weeks back", () => {
    const tue = entry('tue', '2026-11-17', 'lunch');
    expect(canLink(tue, entry('mon', '2026-11-16', 'dinner'), 1)).toBe(true);
    expect(canLink(tue, tue, 1)).toBe(false);
    expect(canLink(tue, entry('wed', '2026-11-18', 'breakfast'), 1)).toBe(false);
    expect(canLink(tue, entry('mon', '2026-11-16', 'dinner', { deleted_at: 'x' }), 1)).toBe(false);
    expect(canLink(tue, entry('old', '2026-11-08', 'dinner'), 1)).toBe(false);
    expect(canLink(tue, entry('prev', '2026-11-09', 'breakfast'), 1)).toBe(true);
  });

  it('lists candidates nearest first', () => {
    const tue = entry('tue', '2026-11-17', 'dinner');
    const entries = [
      entry('a', '2026-11-10', 'dinner'),
      entry('b', '2026-11-17', 'lunch'),
      entry('c', '2026-11-16', 'dinner'),
      tue,
      entry('d', '2026-11-18', 'lunch'),
    ];
    expect(leftoverCandidates(tue, entries, 1).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('finds the source only while the link holds', () => {
    const mon = entry('mon', '2026-11-16', 'dinner');
    const tue = entry('tue', '2026-11-17', 'lunch', { leftover_of_entry_id: 'mon' });
    expect(leftoverSource(tue, [mon, tue], 1)).toBe(mon);
    expect(leftoverSource(tue, [tue], 1)).toBeNull();
    expect(leftoverSource({ ...tue, date: '2026-11-15' }, [mon, tue], 1)).toBeNull();
    expect(leftoverSource(mon, [mon, tue], 1)).toBeNull();
  });

  it('names the links a move breaks, both ways', () => {
    const mon = entry('mon', '2026-11-16', 'dinner');
    const tue = entry('tue', '2026-11-17', 'lunch', { leftover_of_entry_id: 'mon' });
    const wed = entry('wed', '2026-11-18', 'dinner', { leftover_of_entry_id: 'mon' });
    const all = [mon, tue, wed];
    expect(linksBrokenByMove(mon, { date: '2026-11-17', slot: 'breakfast' }, all, 1)).toEqual([]);
    expect(linksBrokenByMove(mon, { date: '2026-11-17', slot: 'dinner' }, all, 1)).toEqual(['tue']);
    expect(linksBrokenByMove(tue, { date: '2026-11-16', slot: 'lunch' }, all, 1)).toEqual(['tue']);
    expect(linksBrokenByMove(tue, { date: '2026-11-19', slot: 'lunch' }, all, 1)).toEqual([]);
  });
});
