import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { signOut } from '@/features/auth/sign-out';
import { BiometricLock } from '@/features/biometric/biometric-lock';
import {
  DEFAULT_LOCK_SETTINGS,
  parseLockSettings,
  shouldLock,
} from '@/features/biometric/lock-policy';
import { LockSettingsSection } from '@/features/biometric/lock-settings';
import {
  readLockSettings,
  writeBackgroundedAt,
  writeLockSettings,
} from '@/features/biometric/lock-store';

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { signOut: async () => ({ error: null }) } }),
}));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  getEnrolledLevelAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));
jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => store.get(key) ?? null,
      setItemSync: (key: string, value: string) => void store.set(key, value),
      removeItemSync: (key: string) => store.delete(key),
      getAllKeys: async () => [...store.keys()],
      removeItem: async (key: string) => void store.delete(key),
    },
  };
});

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const MINUTE = 60_000;

let appStateListener: ((state: AppStateStatus) => void) | undefined;
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
  appStateListener = listener as (state: AppStateStatus) => void;
  return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
});

function app(active = true) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <BiometricLock active={active}>
        <Text testID="household-data">Tuesday: pasta</Text>
        <LockSettingsSection />
      </BiometricLock>
    </SafeAreaProvider>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await signOut(); // clears the stored lock settings
  auth.getEnrolledLevelAsync.mockResolvedValue(3);
  auth.supportedAuthenticationTypesAsync.mockResolvedValue([2]);
  auth.authenticateAsync.mockResolvedValue({ success: true });
});

describe('lock policy (FR-AUTH-6)', () => {
  const on = { enabled: true, timeoutMinutes: 5 as const };

  it('is off by default with a 5-minute timeout', () => {
    expect(DEFAULT_LOCK_SETTINGS).toEqual({ enabled: false, timeoutMinutes: 5 });
    expect(shouldLock(DEFAULT_LOCK_SETTINGS, null, 0)).toBe(false);
  });

  it('locks after the timeout, a cold start or a clock change', () => {
    expect(shouldLock(on, 0, 4 * MINUTE)).toBe(false);
    expect(shouldLock(on, 0, 5 * MINUTE)).toBe(true);
    expect(shouldLock(on, null, 0)).toBe(true);
    expect(shouldLock(on, 10 * MINUTE, 0)).toBe(true);
    expect(shouldLock({ enabled: true, timeoutMinutes: 0 }, 1000, 1000)).toBe(true);
  });

  it('reads saved settings defensively', () => {
    expect(parseLockSettings('{"enabled":true,"timeoutMinutes":15}')).toEqual({
      enabled: true,
      timeoutMinutes: 15,
    });
    expect(parseLockSettings('{"enabled":true,"timeoutMinutes":7}').timeoutMinutes).toBe(5);
    expect(parseLockSettings('not json')).toEqual(DEFAULT_LOCK_SETTINGS);
  });
});

describe('BiometricLock (S-04)', () => {
  it('never prompts when the lock is off', async () => {
    await render(app());
    expect(screen.getByTestId('household-data')).toBeOnTheScreen();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it('covers the data at launch until biometrics unlock it', async () => {
    writeLockSettings({ enabled: true, timeoutMinutes: 5 });
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await render(app());

    expect(screen.getByTestId('lock-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('household-data')).toBeNull(); // hidden from everyone
    expect(auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
    expect(screen.getByTestId('lock-unlock')).toHaveTextContent('Unlock with Face ID');

    await fireEvent.press(screen.getByTestId('lock-unlock'));
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(screen.getByTestId('household-data')).toBeOnTheScreen();
  });

  it('locks again only after the timeout in the background', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    try {
      // The user dismisses the prompt, so the lock screen stays.
      auth.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' });
      writeLockSettings({ enabled: true, timeoutMinutes: 1 });
      writeBackgroundedAt(Date.now());
      await render(app());
      expect(screen.queryByTestId('lock-screen')).toBeNull();

      await act(async () => appStateListener?.('background'));
      // Covered in the app switcher while away.
      expect(screen.getByTestId('lock-screen')).toBeOnTheScreen();
      jest.setSystemTime(Date.now() + 30_000);
      await act(async () => appStateListener?.('active'));
      expect(screen.queryByTestId('lock-screen')).toBeNull();

      await act(async () => appStateListener?.('background'));
      jest.setSystemTime(Date.now() + 2 * MINUTE);
      await act(async () => appStateListener?.('active'));
      expect(screen.getByTestId('lock-screen')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it('turns itself off with a notice when the device can no longer unlock', async () => {
    writeLockSettings({ enabled: true, timeoutMinutes: 5 });
    auth.getEnrolledLevelAsync.mockResolvedValue(0);
    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'passcode_not_set' });
    await render(app());
    expect(await screen.findByTestId('biometric-turned-off')).toBeOnTheScreen();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(readLockSettings().enabled).toBe(false);
  });

  it('is cleared at sign-out', async () => {
    writeLockSettings({ enabled: true, timeoutMinutes: 15 });
    await signOut();
    expect(readLockSettings()).toEqual(DEFAULT_LOCK_SETTINGS);
  });
});

describe('lock settings', () => {
  it('turns on only after a successful check, then offers the timeouts', async () => {
    await render(app());
    await screen.findByText('Lock with Face ID');
    await fireEvent(screen.getByTestId('biometric-switch'), 'valueChange', true);
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(readLockSettings()).toEqual({ enabled: true, timeoutMinutes: 5 });

    await fireEvent.press(screen.getByTestId('biometric-timeout-0'));
    expect(readLockSettings().timeoutMinutes).toBe(0);
    expect(screen.getByTestId('biometric-timeout-15')).toHaveTextContent(/After 15 minutes/);
  });

  it('explains when the device has nothing to unlock with', async () => {
    auth.getEnrolledLevelAsync.mockResolvedValue(0);
    await render(app());
    await screen.findByText('Lock the app');
    await fireEvent(screen.getByTestId('biometric-switch'), 'valueChange', true);
    expect(screen.getByTestId('biometric-message')).toHaveTextContent(/Set up Face ID/);
    expect(readLockSettings().enabled).toBe(false);
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });
});
