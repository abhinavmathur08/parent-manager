import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RecipeEditor } from '@/features/recipes/recipe-editor';

const mockInsert = jest.fn().mockResolvedValue({});
const mockUpdate = jest.fn().mockResolvedValue({});
const mockRemove = jest.fn().mockResolvedValue({});

jest.mock('@/lib/sync', () => ({
  useSyncedRows: () => ({ rows: [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: mockUpdate, remove: mockRemove }),
}));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}` };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function show(onSaved = jest.fn()) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <RecipeEditor
        saved={null}
        recipeId="recipe-1"
        draftKey={`test:${Math.random()}`}
        household={{ locale: 'en-US', region: 'US', unitSystem: 'us_customary' }}
        onSaved={onSaved}
      />
    </SafeAreaProvider>,
  );
  return onSaved;
}

beforeEach(() => jest.clearAllMocks());

it('adds typed lines with fractions, one after another (R-02.2)', async () => {
  await show();
  const quick = screen.getByTestId('recipe-quick-add');
  await fireEvent.changeText(quick, '1 1/2 cups milk');
  await fireEvent(quick, 'submitEditing');
  await fireEvent.changeText(quick, '2 onions');
  await fireEvent.press(screen.getByTestId('recipe-quick-add-submit'));
  expect(screen.getByText('1½ cups milk')).toBeTruthy();
  expect(screen.getByText('2 onions')).toBeTruthy();
});

it('makes an unknown ingredient a household ingredient and saves through the sync layer', async () => {
  const onSaved = await show();
  await fireEvent.changeText(screen.getByTestId('recipe-title'), 'Flatbread');
  const quick = screen.getByTestId('recipe-quick-add');
  await fireEvent.changeText(quick, '2 tbsp grandmas chutney');
  await fireEvent(quick, 'submitEditing');
  expect(screen.getByTestId('line-sheet')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('line-add-new'));
  await fireEvent.press(screen.getByTestId('line-section-condiments'));
  await fireEvent.press(screen.getByTestId('line-done'));
  expect(screen.getByText('2 tbsp grandmas chutney')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('recipe-save'));
  expect(mockInsert.mock.calls.map((c) => c[0])).toEqual([
    'household_ingredients',
    'recipes',
    'recipe_ingredients',
  ]);
  expect(mockInsert.mock.calls[0][2]).toMatchObject({
    name: 'grandmas chutney',
    section_id: 'section.condiments',
    default_dimension: 'volume',
  });
  expect(mockInsert.mock.calls[2][2].ingredient_id).toMatch(/^ingredient\.h\.[0-9a-f]{32}$/);
  expect(onSaved).toHaveBeenCalledWith('recipe-1');
});

it('asks for a title before saving', async () => {
  await show();
  await fireEvent.press(screen.getByTestId('recipe-save'));
  expect(screen.getByText('Give the recipe a title.')).toBeTruthy();
  expect(mockInsert).not.toHaveBeenCalled();
});
