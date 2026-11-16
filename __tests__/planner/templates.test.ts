import { templateCopies, templateFromWeek, type WeekTemplate } from '@/features/planner/templates';
import type { PlanEntryPortionRow, PlanEntryRow } from '@/features/planner/tables';

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const entry = (id: string, date: string, over: Partial<PlanEntryRow> = {}): PlanEntryRow => ({
  ...base,
  id,
  date,
  slot: 'dinner',
  position: 0,
  recipe_id: null,
  free_text: 'Stew',
  servings: 2,
  leftover_of_entry_id: null,
  ...over,
});
const PERSON = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';

describe('templateFromWeek', () => {
  it('keeps leftover links inside the week, portions and recipe titles', () => {
    const rows = [
      entry('a', '2026-11-15', { recipe_id: 'r1', free_text: null }),
      entry('b', '2026-11-16', { slot: 'lunch', leftover_of_entry_id: 'a' }),
      entry('c', '2026-11-17', { leftover_of_entry_id: 'older' }),
      entry('z', '2026-11-22'),
    ];
    const portions = [
      { ...base, id: 'p', entry_id: 'a', person_id: PERSON, portions: 1, variant: 'standard' },
    ] as PlanEntryPortionRow[];
    const saved = templateFromWeek(rows, portions, '2026-11-15', new Map([['r1', 'Lasagne']]));
    expect(saved.map((e) => [e.id, e.day, e.leftover_of])).toEqual([
      ['a', 0, null],
      ['b', 1, 'a'],
      ['c', 2, null],
    ]);
    expect(saved[0].title).toBe('Lasagne');
    expect(saved[0].portions).toEqual([{ person_id: PERSON, portions: 1, variant: 'standard' }]);
  });
});

describe('templateCopies', () => {
  const template: WeekTemplate = {
    id: 't',
    name: 'Usual',
    entries: [
      {
        id: 'b',
        day: 1,
        slot: 'lunch',
        position: 0,
        recipe_id: null,
        free_text: 'Leftover stew',
        title: null,
        servings: 2,
        leftover_of: 'a',
        portions: [],
      },
      {
        id: 'a',
        day: 0,
        slot: 'dinner',
        position: 0,
        recipe_id: 'r1',
        free_text: null,
        title: 'Stew',
        servings: 4,
        leftover_of: null,
        portions: [
          { person_id: PERSON, portions: 1, variant: 'standard' },
          { person_id: GONE, portions: 1, variant: 'standard' },
        ],
      },
    ],
  };

  it('writes sources before their leftovers, after entries kept in the week', () => {
    const kept = [entry('k', '2026-11-22', { position: 0 })];
    const copies = templateCopies(template, '2026-11-22', kept, new Set(['r1']), [
      { id: PERSON } as never,
    ]);
    expect(copies.map((c) => [c.source.id, c.date, c.position, c.leftoverOfSource])).toEqual([
      ['a', '2026-11-22', 1, null],
      ['b', '2026-11-23', 0, 'a'],
    ]);
    expect(copies[0].source.recipe_id).toBe('r1');
    // Portions only for people the household still has.
    expect(copies[0].portions.map((p) => p.person_id)).toEqual([PERSON]);
  });

  it('plans a deleted recipe as its saved title', () => {
    const copies = templateCopies(template, '2026-11-22', [], new Set(), []);
    expect(copies[0].source).toMatchObject({ recipe_id: null, free_text: 'Stew' });
  });
});
