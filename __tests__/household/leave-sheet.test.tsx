import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LeaveSheet, leaveKind, type LeaveKind } from '@/features/household/leave-sheet';

const mockRpc = jest.fn();
const mockRefresh = jest.fn();

jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc }) }));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({ state: { status: 'member' }, refresh: mockRefresh }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderSheet = (kind: LeaveKind) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <LeaveSheet visible householdId="h1" kind={kind} online onClose={jest.fn()} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({ data: { deleted: false }, error: null });
});

describe('leaving the household (FR-HH-8, FR-HH-14)', () => {
  it('works out what leaving means', () => {
    expect(leaveKind(1, 1, true)).toBe('delete');
    expect(leaveKind(3, 1, true)).toBe('last_parent');
    expect(leaveKind(3, 2, true)).toBe('leave');
    expect(leaveKind(3, 1, false)).toBe('leave');
  });

  it('leaves and refreshes the membership', async () => {
    await renderSheet('leave');
    await fireEvent.press(screen.getByTestId('leave-confirm'));
    expect(mockRpc).toHaveBeenCalledWith('leave_household', { household_id: 'h1' });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('names what is deleted when the only member leaves', async () => {
    await renderSheet('delete');
    expect(screen.getByTestId('leave-body')).toHaveTextContent(/deletes the household/);
    expect(screen.getByText('Delete household and leave')).toBeOnTheScreen();
  });

  it('stops the last parent with others from leaving', async () => {
    await renderSheet('last_parent');
    expect(screen.getByTestId('leave-body')).toHaveTextContent(/only parent/);
    expect(screen.queryByTestId('leave-confirm')).toBeNull();
  });

  it('shows the server refusal if a parent left meanwhile', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { hint: 'member.last_parent' } });
    await renderSheet('leave');
    await fireEvent.press(screen.getByTestId('leave-confirm'));
    expect(await screen.findByTestId('leave-error')).toHaveTextContent(/only parent/);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
