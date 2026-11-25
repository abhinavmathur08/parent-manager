import { mealsByDate } from '@/features/calendar/views';
import type { PlanEntryRow } from '@/features/planner/tables';

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};

describe('mealsByDate (FR2-CAL-5)', () => {
  const entry = (id: string, over: Partial<PlanEntryRow>): PlanEntryRow => ({
    ...base,
    id,
    date: '2026-11-18',
    slot: 'dinner',
    position: 0,
    recipe_id: null,
    free_text: id,
    servings: 2,
    leftover_of_entry_id: null,
    ...over,
  });

  it('groups each day by slot in plan order and skips deleted entries', () => {
    const meals = mealsByDate(
      [
        entry('salad', { position: 1 }),
        entry('lasagne', {}),
        entry('soup', { slot: 'lunch' }),
        entry('gone', { deleted_at: '2026-11-17T00:00:00Z' }),
        entry('toast', { date: '2026-11-19', slot: 'breakfast' }),
      ],
      (e) => e.free_text ?? '',
    );
    expect(Object.fromEntries(meals)).toEqual({
      '2026-11-18': [
        { slot: 'lunch', titles: ['soup'] },
        { slot: 'dinner', titles: ['lasagne', 'salad'] },
      ],
      '2026-11-19': [{ slot: 'breakfast', titles: ['toast'] }],
    });
  });

  it('leaves out a day with nothing planned', () => {
    expect(mealsByDate([], () => '').size).toBe(0);
  });
});
