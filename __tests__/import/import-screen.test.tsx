import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ImportError } from '@/features/import/api';
import { ImportScreen } from '@/features/import/import-screen';
import { takeManualPrefill } from '@/features/import/manual';
import { PENDING_IMPORT_KEY } from '@/features/import/use-import-run';

const mockStart = jest.fn();
const mockFetchJob = jest.fn();
const mockReplace = jest.fn();
const mockTrack = jest.fn();
let mockOnline = true;
let mockAllowance: { used: number; allowance: number; resets_on: string } | null = {
  used: 1,
  allowance: 5,
  resets_on: '2026-12-01',
};
const mockStore = new Map<string, string>();
let mockId = 0;

jest.mock('@/features/import/api', () => ({
  ...jest.requireActual('@/features/import/api'),
  startImport: (...args: unknown[]) => mockStart(...args),
  fetchJob: (...args: unknown[]) => mockFetchJob(...args),
}));
jest.mock('@/features/subscription/allowance-notice', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    useAiAllowance: () => mockAllowance,
    AllowanceNotice: ({ allowance }: { allowance: { used: number } | null }) =>
      allowance ? <Text testID="import-allowance">{`used ${allowance.used}`}</Text> : null,
  };
});
jest.mock('@/hooks/use-online', () => ({ useOnline: () => mockOnline }));
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `job-${++mockId}` }));
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
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
const show = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ImportScreen />
    </SafeAreaProvider>,
  );

const DRAFT = {
  title: 'Soup',
  servings: 4,
  prepMinutes: null,
  cookMinutes: null,
  ingredients: [],
  steps: ['Simmer.'],
  tags: [],
  allergens: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockOnline = true;
  mockId = 0;
  mockAllowance = { used: 1, allowance: 5, resets_on: '2026-12-01' };
});

describe('S-19 and S-20 import (FR-AI-1 to FR-AI-3, FR-AI-11)', () => {
  it('shows the allowance and imports pasted text, then opens review', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockStart.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();
    expect(screen.getByTestId('import-allowance')).toHaveTextContent('used 1');

    await fireEvent.changeText(screen.getByTestId('import-text-input'), 'Soup\n1 leek');
    await fireEvent.press(screen.getByTestId('import-text-submit'));
    expect(mockStart).toHaveBeenCalledWith('job-1', { type: 'text', text: 'Soup\n1 leek' });
    expect(mockTrack).toHaveBeenCalledWith('ai_import_started', {
      input_type: 'text',
      allowance_remaining: 4,
    });
    expect(screen.getByTestId('import-progress')).toBeOnTheScreen();

    await act(async () => finish({ draft: DRAFT, source: 'parser' }));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recipes/import/review',
      params: { job: 'job-1' },
    });
  });

  it('is disabled offline, with the offline message (FR-AI-3)', async () => {
    mockOnline = false;
    await show();
    expect(screen.getByTestId('import-offline')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('import-link-input'), 'https://example.com');
    await fireEvent.press(screen.getByTestId('import-link-submit'));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('picks up an import that was running when the member left (S-20)', async () => {
    mockStore.set(
      `draft:${PENDING_IMPORT_KEY}`,
      JSON.stringify({ jobId: 'job-9', input: { type: 'text', text: 'x' }, startedAt: Date.now() }),
    );
    mockFetchJob.mockResolvedValue({
      status: 'succeeded',
      result: { draft: DRAFT, source: 'parser' },
    });
    await show();
    expect(mockFetchJob).toHaveBeenCalledWith('job-9');
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recipes/import/review',
      params: { job: 'job-9' },
    });
  });

  it('a link that fails offers the text instead, a retry and manual entry (FR-AI-13)', async () => {
    mockStart.mockRejectedValue(new ImportError('import.link_unreachable'));
    await show();
    await fireEvent.changeText(screen.getByTestId('import-link-input'), 'https://example.com/r');
    await fireEvent.press(screen.getByTestId('import-link-submit'));

    expect(screen.getByTestId('import-error-message')).toHaveTextContent(/couldn't reach/);
    expect(mockTrack).toHaveBeenCalledWith('ai_import_failed', {
      input_type: 'url',
      error_code: 'import.link_unreachable',
    });
    expect(screen.getByTestId('import-retry')).toBeOnTheScreen();
    expect(screen.getByTestId('import-paste-text')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('import-enter-manually'));
    expect(takeManualPrefill()).toEqual({ sourceUrl: 'https://example.com/r' });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/recipes/edit',
      params: { from: 'import' },
    });
  });

  it('keeps the pasted text for a retry after a timeout (FR-AI-11)', async () => {
    mockStart.mockRejectedValueOnce(new ImportError('import.timeout'));
    mockStart.mockReturnValueOnce(new Promise(() => undefined));
    await show();
    await fireEvent.changeText(screen.getByTestId('import-text-input'), 'Pancakes');
    await fireEvent.press(screen.getByTestId('import-text-submit'));
    expect(screen.getByTestId('import-error-message')).toHaveTextContent(/too long/);
    expect(screen.queryByTestId('import-paste-text')).toBeNull();
    await fireEvent.press(screen.getByTestId('import-retry'));
    expect(mockStart).toHaveBeenLastCalledWith('job-2', { type: 'text', text: 'Pancakes' });
  });

  it('a used-up allowance explains itself and leaves manual entry (FR-AI-10)', async () => {
    mockStart.mockRejectedValue(new ImportError('import.quota_exceeded'));
    await show();
    await fireEvent.changeText(screen.getByTestId('import-text-input'), 'Pancakes');
    await fireEvent.press(screen.getByTestId('import-text-submit'));
    expect(screen.getByTestId('import-error-message')).toHaveTextContent(/this month's imports/);
    expect(screen.getByTestId('import-allowance')).toBeOnTheScreen();
    expect(screen.queryByTestId('import-retry')).toBeNull();
    expect(screen.getByTestId('import-enter-manually')).toBeOnTheScreen();
  });

  it('when the request loses its connection, it reads the job back instead', async () => {
    mockStart.mockRejectedValue(new ImportError('import.network'));
    mockFetchJob.mockResolvedValue({ status: 'failed', code: 'import.parse_failed' });
    await show();
    await fireEvent.changeText(screen.getByTestId('import-text-input'), 'Pancakes');
    await fireEvent.press(screen.getByTestId('import-text-submit'));
    expect(mockFetchJob).toHaveBeenCalledWith('job-1');
    expect(screen.getByTestId('import-error-message')).toHaveTextContent(/couldn't read/);
  });
});
