import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import RecipeDetailRoute from '@/app/(tabs)/recipes/[id]';
import RecipesLayout from '@/app/(tabs)/recipes/_layout';
import RecipesRoute from '@/app/(tabs)/recipes/index';
import { addDays, startOfWeek, todayIn } from '@/features/planner/week';
import { track } from '@/lib/analytics';

// An in-memory sync layer: writes show at once and notify readers, like the local copy.
const mockTables: Record<string, Record<string, Record<string, unknown>>> = {};
const mockListeners = new Set<() => void>();
jest.mock('@/lib/sync', () => {
  const { useEffect, useState } = jest.requireActual<typeof import('react')>('react');
  const write = (table: string, id: string, values: Record<string, unknown>) => {
    mockTables[table] ??= {};
    mockTables[table][id] = {
      household_id: 'h1',
      version: 0,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      ...mockTables[table][id],
      ...values,
      id,
    };
    mockListeners.forEach((l) => l());
    return Promise.resolve(mockTables[table][id]);
  };
  return {
    useSyncedRows: (table: string) => {
      const [, setTick] = useState(0);
      useEffect(() => {
        const listener = () => setTick((n: number) => n + 1);
        mockListeners.add(listener);
        return () => void mockListeners.delete(listener);
      }, []);
      return {
        rows: Object.values(mockTables[table] ?? {}).filter((r) => !r.deleted_at),
        loading: false,
      };
    },
    useSyncWriter: () => ({
      insert: write,
      update: write,
      remove: (table: string, id: string) => write(table, id, { deleted_at: 'now' }),
    }),
  };
});
const mockRole = { current: 'parent' };
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: {
      status: 'member',
      membership: {
        householdId: 'h1',
        role: mockRole.current,
        region: 'US',
        locale: 'en-US',
        unitSystem: 'us_customary',
        weekStart: 1,
        timezone: 'UTC',
      },
    },
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
jest.mock('@/features/people/data', () => ({ fetchPeople: async () => [] }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const thisWeek = startOfWeek(todayIn('UTC'), 1);
const row = (id: string, values: Record<string, unknown>) => ({
  id,
  household_id: 'h1',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
  ...values,
});
const entry = (id: string, date: string, recipeId: string) =>
  row(id, {
    date,
    slot: 'dinner',
    position: 0,
    recipe_id: recipeId,
    free_text: null,
    servings: 2,
    leftover_of_entry_id: null,
  });

function seed() {
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  mockTables.recipes = {
    chili: row('chili', {
      title: 'Chili',
      servings: 4,
      prep_minutes: null,
      cook_minutes: null,
      tags: ['tag.needs_defrosting'],
      notes: null,
      source_type: 'manual',
      source_url: null,
      library_recipe_id: null,
      content_locale: 'en-US',
    }),
  };
  mockTables.plan_entries = {
    past: entry('past', addDays(thisWeek, -7), 'chili'),
    now: entry('now', thisWeek, 'chili'),
    next: entry('next', addDays(thisWeek, 9), 'chili'),
  };
}

const show = () =>
  renderRouter(
    {
      'recipes/_layout': RecipesLayout,
      'recipes/index': RecipesRoute,
      'recipes/[id]': RecipeDetailRoute,
    },
    { initialUrl: '/recipes/chili' },
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRole.current = 'parent';
  seed();
});

describe('deleting a recipe (R-02.3, FR-REC-11)', () => {
  it('says how many entries from this week on use it, and keeps their title as text', async () => {
    await show();
    await fireEvent.press(await screen.findByTestId('recipe-detail-delete'));
    expect(screen.getByTestId('recipe-delete-body')).toHaveTextContent(
      "It's on your plan 2 times from this week on.",
      { exact: false },
    );
    await act(async () => fireEvent.press(screen.getByTestId('recipe-delete-confirm')));

    expect(mockTables.recipes.chili.deleted_at).not.toBeNull();
    for (const id of ['past', 'now', 'next']) {
      expect(mockTables.plan_entries[id]).toMatchObject({ recipe_id: null, free_text: 'Chili' });
    }
    expect(track).toHaveBeenCalledWith('recipe_deleted', { plan_entries_affected: 3 });
  });

  it('says so when the recipe is not planned from this week on', async () => {
    delete mockTables.plan_entries.now;
    delete mockTables.plan_entries.next;
    await show();
    await fireEvent.press(await screen.findByTestId('recipe-detail-delete'));
    expect(screen.getByTestId('recipe-delete-body')).toHaveTextContent(
      "It isn't on your plan from this week on.",
      { exact: false },
    );
  });

  it("isn't offered to a caregiver, who only reads recipes", async () => {
    mockRole.current = 'caregiver';
    await show();
    expect(await screen.findByTestId('recipe-detail')).toBeOnTheScreen();
    expect(screen.queryByTestId('recipe-detail-delete')).toBeNull();
  });
});
