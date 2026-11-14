import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RecipesScreen } from '@/features/recipes/recipes-screen';

const mockPush = jest.fn();
let mockRows: Record<string, unknown[]> = {};

jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
}));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const base = { household_id: 'hh', version: 1, created_at: null, deleted_at: null };
const recipe = (id: string, title: string, tags: string[], updated_at: string) => ({
  ...base,
  id,
  title,
  tags,
  updated_at,
  servings: 4,
  prep_minutes: 10,
  cook_minutes: 20,
});

const show = (canWrite = true) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <RecipesScreen locale="en-US" canWrite={canWrite} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = {};
});

describe('S-16 Recipes tab (FR-REC-1, FR-REC-10)', () => {
  it('offers add and import when there are no recipes', async () => {
    await show();
    expect(screen.getByTestId('recipes-empty')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('recipes-empty-action'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/edit');
    await fireEvent.press(screen.getByTestId('recipes-import'));
    expect(mockPush).toHaveBeenCalledWith('/recipes/import');
  });

  it('shows the starter library to every household, even with no recipes of its own (R-04.1)', async () => {
    await show(false);
    expect(screen.getByTestId('recipes-starter-header')).toBeOnTheScreen();
    expect(screen.getByTestId('starter-card-0')).toHaveTextContent(/Overnight oats/);
    await fireEvent.changeText(screen.getByTestId('recipes-search'), 'lentils');
    expect(screen.getByTestId('starter-card-0')).toHaveTextContent(/Lentil and tomato soup/);
    await fireEvent.press(screen.getByTestId('starter-card-0'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/recipes/starter/[key]',
      params: { key: 'starter.lentil_tomato_soup' },
    });
  });

  it("doesn't offer caregivers add or import", async () => {
    await show(false);
    expect(screen.queryByTestId('recipes-empty-action')).toBeNull();
    expect(screen.queryByTestId('recipes-import')).toBeNull();
  });

  it('lists recipes newest first with time and tags, and searches ingredient names offline', async () => {
    mockRows = {
      recipes: [
        recipe('r1', 'Batch chili', ['tag.freezer_friendly'], '2026-11-01T00:00:00Z'),
        recipe('r2', 'Overnight oats', ['tag.no_cook'], '2026-11-10T00:00:00Z'),
      ],
      recipe_ingredients: [
        {
          ...base,
          id: 'l1',
          recipe_id: 'r2',
          ingredient_id: 'ingredient.milk',
          position: 0,
          updated_at: null,
        },
      ],
    };
    await show();
    expect(screen.getByTestId('recipe-card-0')).toHaveTextContent(
      /Overnight oats.*30 min.*No-cook/,
    );
    expect(screen.getByTestId('recipe-card-1')).toHaveTextContent(/Batch chili/);

    await fireEvent.changeText(screen.getByTestId('recipes-search'), 'milk');
    expect(screen.getByTestId('recipe-card-0')).toHaveTextContent(/Overnight oats/);
    expect(screen.queryByTestId('recipe-card-1')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('recipes-search'), '');
    await fireEvent.press(screen.getByTestId('recipes-filter-freezer_friendly'));
    expect(screen.getByTestId('recipe-card-0')).toHaveTextContent(/Batch chili/);
    // One household recipe and one starter (the soup) are freezer-friendly.
    expect(screen.getAllByText('1 recipe')).toHaveLength(2);
    expect(screen.getByTestId('starter-card-0')).toHaveTextContent(/Lentil and tomato soup/);

    await fireEvent.press(screen.getByTestId('recipes-filter-no_cook'));
    expect(screen.getByTestId('recipes-no-results')).toBeOnTheScreen();
  });
});
