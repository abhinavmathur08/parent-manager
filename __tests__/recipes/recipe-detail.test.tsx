import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RecipeDetail, type RecipeView } from '@/features/recipes/recipe-detail';
import { clearAllergyCache } from '@/features/recipes/use-household-allergies';

const mockFetchPeople = jest.fn();
jest.mock('@/features/people/data', () => ({
  fetchPeople: (...args: unknown[]) => mockFetchPeople(...args),
}));
jest.mock('@/lib/sync', () => ({ useSyncedRows: () => ({ rows: [], loading: false }) }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const RECIPE: RecipeView = {
  id: 'r1',
  title: 'Pancakes',
  servings: 4,
  prepMinutes: 5,
  cookMinutes: 15,
  tags: ['tag.quick'],
  notes: null,
  sourceType: 'url',
  sourceUrl: 'https://example.com/pancakes',
  lines: [
    {
      id: 'l1',
      ingredientId: 'ingredient.milk',
      quantity: 1,
      unitId: 'unit.cup_us',
      note: null,
      optional: false,
    },
    {
      id: 'l2',
      ingredientId: 'ingredient.egg',
      quantity: 2,
      unitId: 'unit.each',
      note: null,
      optional: false,
    },
  ],
  steps: [{ id: 's1', text: 'Whisk and fry.' }],
};

const show = (unitSystem: 'us_customary' | 'metric' = 'us_customary') =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <RecipeDetail recipe={RECIPE} household={{ id: 'hh', locale: 'en-US', unitSystem }} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  clearAllergyCache();
  mockFetchPeople.mockResolvedValue([]);
});

describe('S-17 recipe detail (FR-REC-8, FR-REC-9, FR-AI-15)', () => {
  it('rescales on screen with the stepper', async () => {
    await show();
    expect(screen.getByTestId('recipe-detail-line-0')).toHaveTextContent('1 cup milk');
    await fireEvent.press(screen.getByTestId('recipe-detail-servings-increase'));
    await fireEvent.press(screen.getByTestId('recipe-detail-servings-increase'));
    expect(screen.getByTestId('recipe-detail-line-0')).toHaveTextContent('1½ cups milk');
    expect(screen.getByTestId('recipe-detail-line-1')).toHaveTextContent('3 eggs');
  });

  it('shows US amounts in millilitres for a metric household', async () => {
    await show('metric');
    expect(screen.getByTestId('recipe-detail-line-0')).toHaveTextContent('225 ml milk');
  });

  it('names the allergen and the person, with the disclaimer, when someone is allergic', async () => {
    mockFetchPeople.mockResolvedValue([
      {
        id: 'p1',
        displayName: 'Mo',
        ageBand: 'toddler',
        dueMonth: null,
        allergies: ['allergen.egg'],
        diets: [],
      },
      { id: 'p2', displayName: 'Sam', ageBand: 'adult', dueMonth: null, allergies: [], diets: [] },
    ]);
    await show();
    expect(await screen.findByTestId('recipe-allergen-egg-message')).toHaveTextContent(
      'Contains Egg. Mo is allergic.',
    );
    expect(screen.getByTestId('recipe-allergen-egg-disclaimer')).toHaveTextContent(
      /isn't medical advice/,
    );
    expect(screen.queryByTestId('recipe-allergen-milk')).toBeNull();
  });

  it("says when it couldn't check allergies offline", async () => {
    mockFetchPeople.mockRejectedValue(new TypeError('Network request failed'));
    await show();
    expect(await screen.findByTestId('recipe-allergen-unavailable')).toBeOnTheScreen();
  });

  it('shows where an imported recipe came from', async () => {
    await show();
    expect(screen.getByTestId('recipe-detail-source')).toHaveTextContent(/Imported from a link/);
    expect(screen.getByTestId('recipe-detail-source-link')).toHaveTextContent(
      /example\.com\/pancakes/,
    );
    expect(screen.getByTestId('recipe-detail-times')).toHaveTextContent('Prep 5 min · Cook 15 min');
  });
});
