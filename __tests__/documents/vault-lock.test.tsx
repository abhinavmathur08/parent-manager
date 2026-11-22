import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { AppState, Platform, Text, type AppStateStatus } from 'react-native';

import { signOut } from '@/features/auth/sign-out';
import { VaultGate } from '@/features/documents/vault/vault-gate';
import {
  DEFAULT_VAULT_SETTINGS,
  parseVaultSettings,
  shouldLockVault,
} from '@/features/documents/vault/vault-lock-policy';
import { VaultLockSettingsSection } from '@/features/documents/vault/vault-lock-settings';
import { readVaultSettings, writeVaultSettings } from '@/features/documents/vault/vault-lock-store';
import { openViewerCache, useViewerCache } from '@/features/documents/vault/viewer-cache';
import { scrubBreadcrumb } from '@/lib/crash-reporting';

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
jest.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: jest.fn(),
  enableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
  disableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
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
// A cache folder per path, which records whether it exists.
const mockFolders = new Map<string, boolean>();
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  Directory: jest.fn().mockImplementation((...parts: string[]) => {
    const uri = parts.join('/');
    return {
      uri,
      get exists() {
        return [...mockFolders].some(
          ([path, live]) => live && (path === uri || path.startsWith(`${uri}/`)),
        );
      },
      create: () => void mockFolders.set(uri, true),
      delete: () => {
        for (const path of mockFolders.keys()) {
          if (path === uri || path.startsWith(`${uri}/`)) mockFolders.set(path, false);
        }
      },
    };
  }),
}));

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const capture = ScreenCapture as jest.Mocked<typeof ScreenCapture>;
const MINUTE = 60_000;

let appStateListeners: ((state: AppStateStatus) => void)[] = [];
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
  appStateListeners.push(listener as (state: AppStateStatus) => void);
  return {
    remove: () => {
      appStateListeners = appStateListeners.filter((l) => l !== listener);
    },
  } as ReturnType<typeof AppState.addEventListener>;
});
const goTo = (state: AppStateStatus) => act(async () => appStateListeners.forEach((l) => l(state)));

function vault() {
  return (
    <VaultGate>
      <Text testID="vault-content">Insurance card</Text>
    </VaultGate>
  );
}

let clock: jest.SpyInstance | undefined;
afterEach(() => clock?.mockRestore());

beforeEach(async () => {
  jest.clearAllMocks();
  await signOut(); // locks the vault and clears its stored setting
  auth.getEnrolledLevelAsync.mockResolvedValue(3);
  auth.supportedAuthenticationTypesAsync.mockResolvedValue([2]);
  auth.authenticateAsync.mockResolvedValue({ success: true });
});

describe('vault lock policy (FR2-DOC-3)', () => {
  it('is on by default, locking again after 1 minute away', () => {
    expect(DEFAULT_VAULT_SETTINGS).toEqual({ enabled: true, timeoutMinutes: 1 });
    expect(parseVaultSettings(null)).toEqual(DEFAULT_VAULT_SETTINGS);
    expect(parseVaultSettings('not json')).toEqual(DEFAULT_VAULT_SETTINGS);
    expect(parseVaultSettings('{"enabled":false,"timeoutMinutes":5}')).toEqual({
      enabled: false,
      timeoutMinutes: 5,
    });
  });

  it('locks until unlocked this launch, and after the timeout in the background', () => {
    const on = DEFAULT_VAULT_SETTINGS;
    expect(shouldLockVault(on, { unlockedAt: null, backgroundedAt: null }, 0)).toBe(true);
    expect(shouldLockVault(on, { unlockedAt: 0, backgroundedAt: null }, 60 * MINUTE)).toBe(false);
    expect(shouldLockVault(on, { unlockedAt: 0, backgroundedAt: MINUTE }, MINUTE + 59_000)).toBe(
      false,
    );
    expect(shouldLockVault(on, { unlockedAt: 0, backgroundedAt: MINUTE }, 2 * MINUTE)).toBe(true);
    expect(shouldLockVault(on, { unlockedAt: 0, backgroundedAt: MINUTE }, 0)).toBe(true);
    expect(
      shouldLockVault({ ...on, enabled: false }, { unlockedAt: null, backgroundedAt: null }, 0),
    ).toBe(false);
  });
});

describe('VaultGate (NFR2-SEC-3)', () => {
  it('renders nothing from the vault before unlock', async () => {
    let finish: (value: { success: boolean }) => void = () => undefined;
    auth.authenticateAsync.mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
    await render(vault());
    expect(screen.queryByTestId('vault-content')).toBeNull();
    expect(await screen.findByTestId('vault-locked')).toBeTruthy();
    expect(screen.queryByText('Insurance card')).toBeNull();
    expect(auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );

    await act(async () => finish({ success: true }));
    expect(screen.getByTestId('vault-content')).toBeTruthy();
  });

  it('stays locked when the check is cancelled, and the button asks again', async () => {
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await render(vault());
    expect(await screen.findByTestId('vault-unlock')).toBeTruthy();
    expect(screen.queryByTestId('vault-content')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('vault-unlock')));
    expect(screen.getByTestId('vault-content')).toBeTruthy();
  });

  it("can't be opened on a device with no passcode, even with the lock off", async () => {
    auth.getEnrolledLevelAsync.mockResolvedValue(0);
    writeVaultSettings({ enabled: false, timeoutMinutes: 1 });
    await render(vault());
    expect(await screen.findByTestId('vault-no-passcode')).toBeTruthy();
    expect(screen.queryByTestId('vault-content')).toBeNull();
    expect(screen.queryByTestId('vault-unlock')).toBeNull();
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it('opens without a check when the member turned the lock off', async () => {
    writeVaultSettings({ enabled: false, timeoutMinutes: 1 });
    await render(vault());
    expect(await screen.findByTestId('vault-content')).toBeTruthy();
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it('hides the content while the app is away, and locks again after the timeout', async () => {
    const now = (clock = jest.spyOn(Date, 'now').mockReturnValue(1_000 * MINUTE));
    await render(vault());
    expect(await screen.findByTestId('vault-content')).toBeTruthy();

    await goTo('inactive');
    expect(screen.queryByTestId('vault-content')).toBeNull();
    await goTo('background');
    now.mockReturnValue(1_000 * MINUTE + 30_000);
    await goTo('active');
    expect(screen.getByTestId('vault-content')).toBeTruthy();
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);

    await goTo('background');
    now.mockReturnValue(1_002 * MINUTE);
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await goTo('active');
    expect(screen.queryByTestId('vault-content')).toBeNull();
    expect(screen.getByTestId('vault-locked')).toBeTruthy();
  });

  it('blocks screen capture, blurs the iOS app switcher and keeps no breadcrumbs', async () => {
    Platform.OS = 'ios';
    const view = await render(vault());
    await screen.findByTestId('vault-content');
    expect(capture.usePreventScreenCapture).toHaveBeenCalledWith('vault');
    expect(capture.enableAppSwitcherProtectionAsync).toHaveBeenCalled();
    expect(scrubBreadcrumb({ category: 'navigation', data: { to: '/vault' } })).toBeNull();

    await act(async () => view.unmount());
    expect(capture.disableAppSwitcherProtectionAsync).toHaveBeenCalled();
    expect(scrubBreadcrumb({ category: 'navigation', data: { to: '/plan' } })).not.toBeNull();
  });
});

describe('vault lock setting (FR2-PRIV-3)', () => {
  it('needs a check to turn off, and keeps the lock on if it fails', async () => {
    await render(<VaultLockSettingsSection />);
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await act(async () => fireEvent(screen.getByTestId('vault-lock-switch'), 'valueChange', false));
    expect(readVaultSettings().enabled).toBe(true);

    await act(async () => fireEvent(screen.getByTestId('vault-lock-switch'), 'valueChange', false));
    expect(readVaultSettings().enabled).toBe(false);
  });

  it('keeps its own timeout, apart from the app lock', async () => {
    await render(<VaultLockSettingsSection />);
    await act(async () => fireEvent.press(screen.getByTestId('vault-timeout-5')));
    expect(readVaultSettings()).toEqual({ enabled: true, timeoutMinutes: 5 });
  });
});

describe('viewer cache (FR2-DOC-4)', () => {
  function Viewer({ id }: { id: string }) {
    useViewerCache(id);
    return null;
  }

  it('is removed when the viewer closes', async () => {
    const view = await render(<Viewer id="doc-1" />);
    expect(mockFolders.get('file:///cache/vault-viewer/doc-1')).toBe(true);
    await act(async () => view.unmount());
    expect(mockFolders.get('file:///cache/vault-viewer/doc-1')).toBe(false);
  });

  it('is removed on sign-out', async () => {
    openViewerCache('doc-2');
    expect(mockFolders.get('file:///cache/vault-viewer/doc-2')).toBe(true);
    await signOut();
    expect(mockFolders.get('file:///cache/vault-viewer/doc-2')).toBe(false);
  });
});
