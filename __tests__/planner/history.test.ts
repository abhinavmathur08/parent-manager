import { historyWeeks } from '@/features/planner/history';

const e = (date: string, title: string, deleted = false) => ({
  date,
  deleted_at: deleted ? 'x' : null,
  recipe_id: null,
  free_text: title,
  slot: 'dinner',
  position: 0,
});

describe('S-34 past weeks (FR-LIST-13)', () => {
  const entries = [
    e('2026-11-18', 'This week'),
    e('2026-11-10', 'Soup'),
    e('2026-11-09', 'Chili'),
    e('2026-11-03', 'Gone', true),
    e('2026-10-12', 'Five weeks back'),
    e('2026-10-05', 'Six weeks back'),
  ];
  const lists = [
    { id: 'l1', week_start: '2026-11-08', deleted_at: null },
    { id: 'l2', week_start: '2026-10-04', deleted_at: null },
  ];
  const items = [
    { list_id: 'l1', deleted_at: null, checked: true },
    { list_id: 'l1', deleted_at: null, checked: false },
    { list_id: 'l2', deleted_at: null, checked: true },
  ];
  const run = (free: boolean) =>
    historyWeeks(entries, lists, items, '2026-11-18', 7, (x) => x.free_text ?? '', free);

  it('lists past weeks newest first, with meals in day order and list counts', () => {
    const weeks = run(false);
    expect(weeks.map((w) => w.start)).toEqual(['2026-11-08', '2026-10-11', '2026-10-04']);
    expect(weeks[0].meals.map((m) => m.title)).toEqual(['Chili', 'Soup']);
    expect(weeks[0].items).toEqual({ total: 2, bought: 1 });
    expect(weeks[1].items).toBeNull();
  });

  it('keeps Free to the 4 weeks before this one (D-9)', () => {
    expect(run(true).map((w) => w.start)).toEqual(['2026-11-08']);
  });
});
