import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CalendarSettingsScreen } from '@/features/calendar/device/settings-screen';
import { readDeviceSettings } from '@/features/calendar/device/settings';

type Response = { granted: boolean; canAskAgain: boolean };
let mockCurrent: Response = { granted: false, canAskAgain: true };
let mockAnswer: Response = { granted: true, canAskAgain: true };
const mockGet = jest.fn(async () => mockCurrent);
const mockRequest = jest.fn(async () => {
  mockCurrent = mockAnswer;
  return mockAnswer;
});
jest.mock('expo-calendar', () => ({
  getCalendarPermissions: () => mockGet(),
  requestCalendarPermissions: () => mockRequest(),
}));
const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => void mockStore.set(key, value),
    removeItemSync: (key: string) => mockStore.delete(key),
  },
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <CalendarSettingsScreen householdId="h1" onBack={jest.fn()} />
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockCurrent = { granted: false, canAskAgain: true };
  mockAnswer = { granted: true, canAskAgain: true };
});

describe('calendar settings (S-39)', () => {
  it('opens with both features off and never asks for the calendar (NFR2-SEC-5)', async () => {
    await renderScreen();
    expect(screen.getByTestId('calendar-copy-switch')).not.toBeChecked();
    expect(screen.getByTestId('calendar-busy-switch')).not.toBeChecked();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('explains first, then asks, then turns the feature on (FR2-DEV-1)', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('calendar-copy-switch'));
    expect(screen.getByTestId('calendar-permission-body')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('calendar-permission-continue'));
    await waitFor(() => expect(screen.getByTestId('calendar-copy-switch')).toBeChecked());
    expect(mockTrack).toHaveBeenCalledWith('calendar_permission_result', { granted: true });
    expect(readDeviceSettings('h1').copy).toBe(true);
    expect(readDeviceSettings('h1').busy).toBe(false);
  });

  it('leaves the feature off with "Not now", without asking', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('calendar-busy-switch'));
    await fireEvent.press(screen.getByTestId('calendar-permission-not-now'));
    expect(mockRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId('calendar-busy-switch')).not.toBeChecked();
  });

  it('stays off and says so when the member declines', async () => {
    mockAnswer = { granted: false, canAskAgain: false };
    await renderScreen();
    await fireEvent.press(screen.getByTestId('calendar-busy-switch'));
    await fireEvent.press(screen.getByTestId('calendar-permission-continue'));
    await waitFor(() => expect(screen.getByTestId('calendar-access-off')).toBeTruthy());
    expect(screen.getByTestId('calendar-busy-switch')).not.toBeChecked();
    expect(mockTrack).toHaveBeenCalledWith('calendar_permission_result', { granted: false });
    expect(readDeviceSettings('h1').busy).toBe(false);
  });

  it('turns a feature on at once when access was already given, and off again', async () => {
    mockCurrent = { granted: true, canAskAgain: true };
    await renderScreen();
    await fireEvent.press(screen.getByTestId('calendar-copy-switch'));
    expect(screen.getByTestId('calendar-copy-switch')).toBeChecked();
    expect(mockRequest).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('calendar-copy-switch'));
    expect(screen.getByTestId('calendar-copy-switch')).not.toBeChecked();
  });

  it('sends the member to Settings once the permission is refused for good', async () => {
    mockCurrent = { granted: false, canAskAgain: false };
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await renderScreen();
    expect(screen.getByTestId('calendar-access-off')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('calendar-copy-switch'));
    await fireEvent.press(screen.getByTestId('calendar-permission-continue'));
    expect(open).toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
