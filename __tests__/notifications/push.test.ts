import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  readPushPermission,
  registerPushToken,
  requestPushPermission,
  unregisterPushToken,
} from '@/lib/notifications/push';

const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
const mockRpc = jest.fn(async (..._args: unknown[]) => ({ error: null }));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));
const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => mockStore.set(key, value),
    removeItemSync: (key: string) => mockStore.delete(key),
  },
}));
jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));
jest.mock('expo-notifications', () => ({
  IosAuthorizationStatus: { PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
  setNotificationChannelAsync: jest.fn(),
}));

const notifications = jest.mocked(Notifications);
type Status = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;
const status = (over: Record<string, unknown>) =>
  ({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
    ...over,
  }) as Status;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
});

describe('push permission (FR-NOT-2)', () => {
  it('reads granted, not asked yet and denied', async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce(
      status({ status: 'granted', granted: true }),
    );
    expect(await readPushPermission()).toBe('granted');
    notifications.getPermissionsAsync.mockResolvedValueOnce(status({}));
    expect(await readPushPermission()).toBe('undetermined');
    notifications.getPermissionsAsync.mockResolvedValueOnce(status({ status: 'denied' }));
    expect(await readPushPermission()).toBe('denied');
    // The system won't ask again: only settings can turn it on.
    notifications.getPermissionsAsync.mockResolvedValueOnce(status({ canAskAgain: false }));
    expect(await readPushPermission()).toBe('denied');
  });

  it('counts provisional iOS permission as granted', async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce(status({ ios: { status: 3 } }));
    expect(await readPushPermission()).toBe('granted');
  });

  it('asks without sound, tracks the prompt and registers the token when granted', async () => {
    notifications.requestPermissionsAsync.mockResolvedValueOnce(
      status({ status: 'granted', granted: true }),
    );
    notifications.getPermissionsAsync.mockResolvedValue(
      status({ status: 'granted', granted: true }),
    );
    expect(await requestPushPermission('week_planned', 'Reminders')).toBe('granted');
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    });
    expect(mockTrack).toHaveBeenNthCalledWith(1, 'push_permission_prompted', {
      trigger: 'week_planned',
    });
    expect(mockTrack).toHaveBeenNthCalledWith(2, 'push_permission_result', { granted: true });
    expect(mockRpc).toHaveBeenCalledWith('register_push_token', {
      push_token: 'ExponentPushToken[abc]',
      push_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  });

  it('records a refusal and registers nothing', async () => {
    notifications.requestPermissionsAsync.mockResolvedValueOnce(status({ status: 'denied' }));
    expect(await requestPushPermission('settings', 'Reminders')).toBe('denied');
    expect(mockTrack).toHaveBeenLastCalledWith('push_permission_result', { granted: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('push tokens', () => {
  it('registers only with permission', async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce(status({}));
    expect(await registerPushToken()).toBe(false);
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('fails quietly when no token can be had, as on some simulators', async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce(
      status({ status: 'granted', granted: true }),
    );
    notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no APNs'));
    expect(await registerPushToken()).toBe(false);
  });

  it('removes this device token at sign-out (FR-AUTH-7)', async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce(
      status({ status: 'granted', granted: true }),
    );
    await registerPushToken();
    await unregisterPushToken();
    expect(mockRpc).toHaveBeenLastCalledWith('unregister_push_token', {
      push_token: 'ExponentPushToken[abc]',
    });
    mockRpc.mockClear();
    await unregisterPushToken();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
