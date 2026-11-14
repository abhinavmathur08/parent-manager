import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import RecipeDetailRoute from '@/app/(tabs)/recipes/[id]';
import RecipesLayout from '@/app/(tabs)/recipes/_layout';
import RecipeEditRoute from '@/app/(tabs)/recipes/edit';
import RecipesRoute from '@/app/(tabs)/recipes/index';

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
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: {
      status: 'member',
      membership: {
        householdId: 'h1',
        role: 'parent',
        region: 'US',
        locale: 'en-US',
        unitSystem: 'us_customary',
      },
    },
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
jest.mock('@/features/people/data', () => ({ fetchPeople: async () => [] }));

beforeEach(() => {
  for (const key of Object.keys(mockTables)) delete mockTables[key];
});

it('opens the new recipe after saving it from the Recipes tab (R-02.2, R-03.2)', async () => {
  await renderRouter(
    {
      'recipes/_layout': RecipesLayout,
      'recipes/index': RecipesRoute,
      'recipes/edit': RecipeEditRoute,
      'recipes/[id]': RecipeDetailRoute,
    },
    { initialUrl: '/recipes' },
  );
  await fireEvent.press(screen.getByTestId('recipes-add'));
  await fireEvent.changeText(await screen.findByTestId('recipe-title'), 'Weeknight flatbread');
  await fireEvent.changeText(screen.getByTestId('recipe-quick-add'), '1 1/2 cups milk');
  await fireEvent.press(screen.getByTestId('recipe-quick-add-submit'));
  await act(async () => fireEvent.press(screen.getByTestId('recipe-save')));

  expect(await screen.findByTestId('recipe-detail-edit')).toBeOnTheScreen();
  expect(screen).toHavePathname(`/recipes/${Object.keys(mockTables.recipes)[0]}`);
});
