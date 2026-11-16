import { render } from '@testing-library/react-native';

import { HISTORY_TABLES, HistorySync } from '@/features/subscription/history-sync';

const mockRefetch = jest.fn(async () => undefined);
let mockTier: 'free' | 'premium' | null = null;

jest.mock('@/lib/sync', () => ({ useSyncEngine: () => ({ refetch: mockRefetch }) }));
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ entitlement: mockTier ? { tier: mockTier } : null }),
}));

it('pulls the history tables in full when the tier changes, not on first load', async () => {
  const view = await render(<HistorySync />);
  mockTier = 'free';
  await view.rerender(<HistorySync />);
  expect(mockRefetch).not.toHaveBeenCalled();
  mockTier = 'premium';
  await view.rerender(<HistorySync />);
  expect(mockRefetch).toHaveBeenCalledWith(HISTORY_TABLES);
  mockTier = 'free';
  await view.rerender(<HistorySync />);
  expect(mockRefetch).toHaveBeenCalledTimes(2);
});
