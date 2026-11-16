import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReviewScreen } from '@/features/import/review-screen';
import { PENDING_IMPORT_KEY } from '@/features/import/use-import-run';

const mockInsert = jest.fn().mockResolvedValue({});
const mockFetchJob = jest.fn();
const mockReplace = jest.fn();
const mockTrack = jest.fn();
const mockStore = new Map<string, string>();
let mockPeople = [{ displayName: 'Sam', allergies: ['allergen.peanut'] }];

jest.mock('@/lib/sync', () => ({
  useSyncedRows: () => ({ rows: [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: jest.fn(), remove: jest.fn() }),
}));
jest.mock('@/features/import/api', () => ({
  ...jest.requireActual('@/features/import/api'),
  fetchJob: (...args: unknown[]) => mockFetchJob(...args),
}));
jest.mock('@/features/recipes/use-household-allergies', () => ({
  useHouseholdAllergies: () => ({ people: mockPeople, status: 'ready' }),
}));
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
});
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => void mockStore.set(key, value),
    removeItemSync: (key: string) => mockStore.delete(key),
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const line = (original: string, extra: Record<string, unknown>) => ({
  original,
  quantity: null,
  unitId: null,
  ingredientName: null,
  note: null,
  confidence: 0.95,
  ...extra,
});

const DRAFT = {
  title: 'Satay noodles',
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 10,
  ingredients: [
    line('2 tbsp peanut butter', {
      quantity: 2,
      unitId: 'unit.tbsp_us',
      ingredientName: 'peanut butter',
    }),
    line('100 g zorblax paste', {
      quantity: 100,
      unitId: 'unit.g',
      ingredientName: 'zorblax paste',
    }),
    line('soy sauce', { ingredientName: 'soy sauce', confidence: 0.6 }),
  ],
  steps: ['Cook the noodles.', 'Toss with the sauce.'],
  tags: [],
  allergens: ['allergen.sesame'],
};

async function show() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ReviewScreen
        job="job-1"
        household={{ id: 'hh', locale: 'en-US', region: 'US', unitSystem: 'us_customary' }}
      />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockPeople = [{ displayName: 'Sam', allergies: ['allergen.peanut'] }];
  mockStore.set(
    `draft:${PENDING_IMPORT_KEY}`,
    JSON.stringify({ jobId: 'job-1', input: { type: 'text', text: 'x' }, startedAt: Date.now() }),
  );
  mockFetchJob.mockResolvedValue({
    status: 'succeeded',
    result: { draft: DRAFT, source: 'parser' },
  });
});

describe('S-21 import review (FR-AI-4 to FR-AI-7)', () => {
  it('flags an allergen matching a household person, with the disclaimer (FR-AI-7)', async () => {
    await show();
    expect(screen.getByTestId('import-allergen-peanut-message')).toHaveTextContent(
      /may contain Peanuts?. Sam is allergic/i,
    );
    expect(screen.getByTestId('import-allergen-peanut-disclaimer')).toHaveTextContent(
      /isn't medical advice/,
    );
    expect(screen.getByTestId('import-line-0-allergen-peanut')).toBeOnTheScreen();
    // The source's own mention is shown too, though nobody is allergic to it (AI-11).
    expect(screen.getByTestId('import-source-allergens')).toHaveTextContent(/Sesame/);
    expect(mockTrack).toHaveBeenCalledWith('allergen_notice_shown', {
      surface: 'import_review',
      allergen_count: 2,
    });
  });

  it('shows each line with its original text and highlights uncertain ones (FR-AI-5, FR-AI-6)', async () => {
    await show();
    expect(screen.getByTestId('recipe-title').props.value).toBe('Satay noodles');
    expect(screen.getByTestId('import-line-original-1')).toHaveTextContent(/100 g zorblax paste/);
    expect(screen.getByTestId('import-line-1-unmatched')).toBeOnTheScreen();
    expect(screen.getByTestId('import-line-1-unchecked')).toBeOnTheScreen();
    expect(screen.getByTestId('import-line-2-low')).toBeOnTheScreen();
    expect(screen.queryByTestId('import-line-0-low')).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith(
      'ai_import_completed',
      expect.objectContaining({
        input_type: 'text',
        parser: 'llm',
        ingredient_count: 3,
        unmatched_count: 1,
        low_confidence_count: 1,
      }),
    );
  });

  it('saves nothing until the member saves, then records the import source (FR-AI-4, FR-AI-15)', async () => {
    await show();
    expect(mockInsert).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('recipe-save'));
    const tables = mockInsert.mock.calls.map((c) => c[0]);
    expect(tables).toEqual([
      'household_ingredients',
      'recipes',
      'recipe_ingredients',
      'recipe_ingredients',
      'recipe_ingredients',
      'recipe_steps',
      'recipe_steps',
    ]);
    const recipe = mockInsert.mock.calls.find((c) => c[0] === 'recipes')![2];
    expect(recipe).toEqual(
      expect.objectContaining({ title: 'Satay noodles', source_type: 'text' }),
    );
    expect(mockTrack).toHaveBeenCalledWith(
      'ai_import_saved',
      expect.objectContaining({ input_type: 'text', lines_edited_count: 0 }),
    );
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recipes/[id]',
      params: { id: expect.any(String) },
    });
    expect(mockStore.has(`draft:${PENDING_IMPORT_KEY}`)).toBe(false);
  });

  it('discards only after confirming, and saves nothing', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await show();
    await fireEvent.press(screen.getByTestId('import-review-discard'));
    const buttons = alert.mock.calls[0][2]!;
    expect(mockReplace).not.toHaveBeenCalled();
    await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress!());
    expect(mockReplace).toHaveBeenCalledWith('/recipes');
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(
      'ai_import_discarded',
      expect.objectContaining({ input_type: 'text' }),
    );
  });

  it('"enter manually instead" opens the editor with the title and the raw text (FR-AI-13)', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('import-review-manual'));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recipes/edit',
      params: { from: 'import' },
    });
    const { takeManualPrefill } = jest.requireActual('@/features/import/manual');
    expect(takeManualPrefill()).toEqual(
      expect.objectContaining({
        title: 'Satay noodles',
        notes: expect.stringContaining('100 g zorblax paste'),
      }),
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
