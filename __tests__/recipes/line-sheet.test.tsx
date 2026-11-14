import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { buildIngredients } from '@/features/ingredients/use-ingredients';
import { LineSheet } from '@/features/recipes/line-sheet';

jest.mock('@/lib/sync', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'aaaaaaaa-4444-0000-0000-000000000001' }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const blank = {
  id: 'line-1',
  ingredientId: '',
  quantity: null,
  unitId: null,
  rawText: null,
  note: null,
  optional: false,
  isNew: true,
};

async function show(props: Partial<Parameters<typeof LineSheet>[0]> = {}) {
  const onDone = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <LineSheet
        initial={blank}
        ingredients={buildIngredients('en-AU', [])}
        newIngredients={[]}
        locale="en-AU"
        region="AU"
        unitSystem="metric"
        onDone={onDone}
        onRemove={jest.fn()}
        onClose={jest.fn()}
        {...props}
      />
    </SafeAreaProvider>,
  );
  return onDone;
}

describe('the line sheet (FR-REC-5)', () => {
  it('takes a mixed number, a regional unit and a searched ingredient', async () => {
    const onDone = await show();
    await fireEvent.changeText(screen.getByTestId('line-quantity'), '1 1/2');
    await fireEvent.press(screen.getByTestId('line-unit-tbsp_au'));
    await fireEvent.changeText(screen.getByTestId('line-search'), 'courgette');
    await fireEvent.press(screen.getByTestId('line-result-0'));
    await fireEvent.press(screen.getByTestId('line-done'));
    expect(onDone).toHaveBeenCalledWith({
      line: expect.objectContaining({
        quantity: 1.5,
        unitId: 'unit.tbsp_au',
        ingredientId: 'ingredient.zucchini',
      }),
      newIngredient: null,
    });
  });

  it('shows the household system first and hides the rest under "more units"', async () => {
    await show();
    expect(screen.getByTestId('line-unit-cup_metric')).toBeOnTheScreen();
    expect(screen.queryByTestId('line-unit-cup_us')).toBeNull();
    await fireEvent.press(screen.getByTestId('line-units-more'));
    expect(screen.getByTestId('line-unit-cup_us')).toBeOnTheScreen();
  });

  it('adds an unknown ingredient as a household ingredient with a section', async () => {
    const onDone = await show();
    await fireEvent.press(screen.getByTestId('line-unit-g'));
    await fireEvent.changeText(screen.getByTestId('line-search'), 'Wattleseed');
    await fireEvent.press(screen.getByTestId('line-add-new'));
    await fireEvent.press(screen.getByTestId('line-section-spices'));
    await fireEvent.press(screen.getByTestId('line-done'));
    expect(onDone).toHaveBeenCalledWith({
      line: expect.objectContaining({
        ingredientId: 'ingredient.h.aaaaaaaa444400000000000000000001',
      }),
      newIngredient: {
        rowId: 'aaaaaaaa-4444-0000-0000-000000000001',
        ingredientId: 'ingredient.h.aaaaaaaa444400000000000000000001',
        name: 'Wattleseed',
        sectionId: 'section.spices',
        dimension: 'mass',
      },
    });
  });

  it('refuses an amount it can not read, and a line with no ingredient', async () => {
    const onDone = await show();
    await fireEvent.changeText(screen.getByTestId('line-quantity'), 'a few');
    await fireEvent.press(screen.getByTestId('line-done'));
    expect(screen.getByText('Enter an amount such as 2, 1/2 or 1 1/2.')).toBeOnTheScreen();
    expect(screen.getByText('Choose an ingredient, or add a new one.')).toBeOnTheScreen();
    expect(onDone).not.toHaveBeenCalled();
  });
});
