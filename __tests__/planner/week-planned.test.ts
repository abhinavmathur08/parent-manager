import { renderHook } from '@testing-library/react-native';

import type { PlanEntryRow } from '@/features/planner/tables';
import { dinnersPlanned, useWeekPlannedEvent } from '@/features/planner/week-planned';

const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => mockStore.set(key, value),
  },
}));

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const entry = (id: string, date: string, slot: string, over: Partial<PlanEntryRow> = {}) =>
  ({
    ...base,
    id,
    date,
    slot,
    position: 0,
    recipe_id: null,
    free_text: 'x',
    servings: 2,
    leftover_of_entry_id: null,
    ...over,
  }) as PlanEntryRow;

beforeEach(() => {
  mockTrack.mockClear();
  mockStore.clear();
});

describe('dinners planned (FR-PLAN-12)', () => {
  it('counts days with a dinner in the week, once per day', () => {
    const rows = [
      entry('a', '2026-11-15', 'dinner'),
      entry('b', '2026-11-15', 'dinner', { position: 1 }),
      entry('c', '2026-11-16', 'lunch'),
      entry('d', '2026-11-17', 'dinner', { deleted_at: 'x' }),
      entry('e', '2026-11-21', 'dinner'),
      entry('f', '2026-11-22', 'dinner'),
    ];
    expect(dinnersPlanned(rows, '2026-11-15')).toBe(2);
  });
});

describe('week_planned (FR-PLAN-12)', () => {
  const render = (dinners: number, start = '2026-11-15') =>
    renderHook(
      ({ d, s }: { d: number; s: string }) => useWeekPlannedEvent('hh', s, '2026-11-13', d),
      { initialProps: { d: dinners, s: start } },
    );

  it('fires once when this device takes the week to 5 dinners', async () => {
    const hook = await render(4);
    hook.result.current();
    await hook.rerender({ d: 5, s: '2026-11-15' });
    expect(mockTrack).toHaveBeenCalledWith('week_planned', {
      dinners_count: 5,
      days_until_week_start: 2,
    });
    // Down and back up again in the same week: still once.
    await hook.rerender({ d: 4, s: '2026-11-15' });
    hook.result.current();
    await hook.rerender({ d: 6, s: '2026-11-15' });
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });

  it("doesn't fire for a partner's change arriving by sync", async () => {
    const hook = await render(4);
    await hook.rerender({ d: 5, s: '2026-11-15' });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("doesn't fire for opening a week that is already planned", async () => {
    const hook = await render(2, '2026-11-08');
    hook.result.current();
    await hook.rerender({ d: 6, s: '2026-11-15' });
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
