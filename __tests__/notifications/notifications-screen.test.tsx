import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NotificationsScreen } from '@/features/notifications/notifications-screen';
import { DEFAULT_PREFS, type NotificationPrefs } from '@/features/notifications/prefs';
import type { PushPermission } from '@/lib/notifications/push';

jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => store.get(key) ?? null,
      setItemSync: (key: string, value: string) => void store.set(key, value),
    },
  };
});

let mockPermission: PushPermission = 'granted';
const mockRequest = jest.fn(async (..._args: unknown[]) => {
  mockPermission = 'granted';
  return 'granted';
});
jest.mock('@/lib/notifications/push', () => ({
  readPushPermission: async () => mockPermission,
  requestPushPermission: (...args: unknown[]) => mockRequest(...args),
  openSystemNotificationSettings: jest.fn(),
}));
let mockServer: NotificationPrefs = DEFAULT_PREFS;
let mockSaveFails = false;
const mockSave = jest.fn(async (_user: string, prefs: NotificationPrefs) => {
  if (mockSaveFails) throw new Error('offline');
  mockServer = prefs;
});
jest.mock('@/features/notifications/prefs', () => ({
  ...jest.requireActual('@/features/notifications/prefs'),
  cachedPrefs: () => jest.requireActual('@/features/notifications/prefs').DEFAULT_PREFS,
  fetchPrefs: async () => mockServer,
  savePrefs: (user: string, prefs: NotificationPrefs) => mockSave(user, prefs),
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function renderScreen(weekStart = 7) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NotificationsScreen userId="u1" household={{ weekStart, timezone: 'America/New_York' }} />
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('push-status')).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermission = 'granted';
  mockServer = DEFAULT_PREFS;
  mockSaveFails = false;
});

describe('notification settings (S-29)', () => {
  it('shows each type on by default, with the defaults for times', async () => {
    await renderScreen();
    for (const type of [
      'plan_week',
      'list_ready',
      'defrost',
      'household_changes',
      'calendar_reminders',
      'event_changes',
      'who_taking',
      'document_expiry',
    ]) {
      expect(screen.getByTestId(`notification-type-${type}`)).toBeChecked();
    }
    // A Sunday week: the reminder is Saturday at 18:00.
    expect(screen.getByText('Saturday')).toBeTruthy();
    expect(screen.getByText('6:00 PM')).toBeTruthy();
    expect(screen.getByText('9:00 PM')).toBeTruthy();
    expect(screen.getByText('7:00 AM')).toBeTruthy();
    expect(screen.getByTestId('quiet-note')).toHaveTextContent(/America\/New_York/);
  });

  it('defaults the reminder to Sunday for a Monday week', async () => {
    await renderScreen(1);
    expect(screen.getByText('Sunday')).toBeTruthy();
  });

  it('turns a type off on the server and records it (FR-NOT-7)', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('notification-type-list_ready'));
    expect(mockSave).toHaveBeenLastCalledWith('u1', { ...DEFAULT_PREFS, list_ready: false });
    expect(mockTrack).toHaveBeenCalledWith('notification_type_toggled', {
      type: 'list_ready',
      enabled: false,
      surface: 'settings',
    });
    expect(screen.getByTestId('notification-type-list_ready')).not.toBeChecked();
  });

  it('hides the reminder day and time while "plan your week" is off', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('notification-type-plan_week'));
    expect(screen.queryByTestId('plan-week-day')).toBeNull();
  });

  it('asks for permission when a device type is turned on before the system was asked (FR-NOT-2)', async () => {
    mockPermission = 'undetermined';
    mockServer = { ...DEFAULT_PREFS, defrost: false };
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('notification-type-defrost')).not.toBeChecked());
    await act(async () => {
      fireEvent.press(screen.getByTestId('notification-type-defrost'));
    });
    expect(mockRequest).toHaveBeenCalledWith('settings', 'Reminders');
    expect(mockSave).toHaveBeenLastCalledWith('u1', { ...DEFAULT_PREFS, defrost: true });
  });

  it("doesn't ask for inbox-only household changes", async () => {
    mockPermission = 'undetermined';
    mockServer = { ...DEFAULT_PREFS, household_changes: false };
    await renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('notification-type-household_changes')).not.toBeChecked(),
    );
    await fireEvent.press(screen.getByTestId('notification-type-household_changes'));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('shows device types as off in system settings when permission is denied (FR-NOT-2)', async () => {
    mockPermission = 'denied';
    await renderScreen();
    const defrost = screen.getByTestId('notification-type-defrost');
    expect(defrost).not.toBeChecked();
    expect(defrost).toBeDisabled();
    expect(screen.getAllByText('Off in system settings')).toHaveLength(10);
    expect(screen.queryByTestId('event-details-switch')).toBeNull();
    expect(screen.getByTestId('notification-type-household_changes')).toBeChecked();
    expect(screen.getByTestId('push-open-settings')).toBeTruthy();
  });

  it('changes quiet hours and records the hours only (FR-NOT-6)', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('quiet-start'));
    await fireEvent.press(screen.getByTestId('choose-quietStartMinute-1320'));
    expect(mockSave).toHaveBeenLastCalledWith('u1', { ...DEFAULT_PREFS, quietStartMinute: 1320 });
    expect(mockTrack).toHaveBeenCalledWith('quiet_hours_changed', { start_hour: 22, end_hour: 7 });
    expect(screen.getByText('10:00 PM')).toBeTruthy();
  });

  it('changes the reminder day (FR-NOT-3)', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('plan-week-day'));
    await fireEvent.press(screen.getByTestId('choose-planWeekDay-5'));
    expect(mockSave).toHaveBeenLastCalledWith('u1', { ...DEFAULT_PREFS, planWeekDay: 5 });
  });

  it('puts a change back and says so when it cannot be saved', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockSaveFails = true;
    await renderScreen();
    await fireEvent.press(screen.getByTestId('notification-type-list_ready'));
    expect(alert).toHaveBeenCalled();
    expect(screen.getByTestId('notification-type-list_ready')).toBeChecked();
    expect(mockTrack).not.toHaveBeenCalledWith('notification_type_toggled', expect.anything());
  });

  it('turns event details on for this device only, off by default (FR2-REM-3)', async () => {
    await renderScreen();
    const details = screen.getByTestId('event-details-switch');
    expect(details).not.toBeChecked();
    await fireEvent.press(details);
    await waitFor(() => expect(screen.getByTestId('event-details-switch')).toBeChecked());
    expect(mockSave).not.toHaveBeenCalled();
  });
});
