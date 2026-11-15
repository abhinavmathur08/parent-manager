import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import { track } from '@/lib/analytics';
import { getSupabase } from '@/lib/supabase';

/**
 * Push permission as the app shows it (FR-NOT-2): `granted`, `undetermined` (the system can
 * still ask) or `denied` (only system settings can turn it on).
 */
export type PushPermission = 'granted' | 'undetermined' | 'denied';

/** Where a permission request came from, for `push_permission_prompted`. */
export type PushPromptTrigger = 'week_planned' | 'settings';

/** The Android channel every notification uses. It makes no sound (FR-NOT-6, NFR-A11Y-7). */
export const DEFAULT_CHANNEL_ID = 'default';

const TOKEN_KEY = 'notifications.push_token';

function permissionOf(response: Notifications.NotificationPermissionsStatus): PushPermission {
  const ios = response.ios?.status;
  if (
    response.granted ||
    ios === IosAuthorizationStatus.PROVISIONAL ||
    ios === IosAuthorizationStatus.EPHEMERAL
  ) {
    return 'granted';
  }
  // Android 13+ reports a permission it has never asked for as `denied` (notifications are
  // off until granted) with `canAskAgain` true, so whether the system can still ask decides.
  return response.canAskAgain ? 'undetermined' : 'denied';
}

export async function readPushPermission(): Promise<PushPermission> {
  return permissionOf(await Notifications.getPermissionsAsync());
}

/**
 * Creates the silent Android channel. Android 13 and later show the permission prompt only
 * once a channel exists, so this runs before asking. `name` is the translated channel name
 * shown in system settings.
 */
export async function ensureNotificationChannel(name: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
    name,
    importance: AndroidImportance.DEFAULT,
    sound: null,
    enableVibrate: false,
    showBadge: false,
  });
}

/**
 * Asks the system for permission (FR-NOT-2). Only call it in context: after the member's
 * first planned week or when they turn a push type on, never at launch or in onboarding
 * (FR-ONB-8). Registers this device's token when permission is granted.
 */
export async function requestPushPermission(
  trigger: PushPromptTrigger,
  channelName: string,
): Promise<PushPermission> {
  track('push_permission_prompted', { trigger });
  await ensureNotificationChannel(channelName);
  const result = permissionOf(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    }),
  );
  track('push_permission_result', { granted: result === 'granted' });
  if (result === 'granted') await registerPushToken();
  return result;
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

function storedToken(): string | null {
  try {
    return Storage.getItemSync(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) Storage.setItemSync(TOKEN_KEY, token);
    else Storage.removeItemSync(TOKEN_KEY);
  } catch {
    // Without storage, sign-out can't remove the token; the server drops it once it fails.
  }
}

/**
 * Saves this device's Expo push token for the signed-in user, when permission is granted.
 * Getting a token needs the network and fails on some simulators, so failures are quiet: the
 * member still gets the in-app inbox, and the next launch tries again.
 */
export async function registerPushToken(token?: string): Promise<boolean> {
  try {
    if ((await readPushPermission()) !== 'granted') return false;
    const value =
      token ?? (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
    const { error } = await getSupabase().rpc('register_push_token', {
      push_token: value,
      push_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (error) return false;
    storeToken(value);
    return true;
  } catch {
    return false;
  }
}

/** Removes this device's token from the server at sign-out (FR-AUTH-7). */
export async function unregisterPushToken(): Promise<void> {
  const token = storedToken();
  if (!token) return;
  storeToken(null);
  await getSupabase().rpc('unregister_push_token', { push_token: token });
}

/** Opens this app's page in the system settings, where a denied permission can be changed. */
export function openSystemNotificationSettings(): Promise<void> {
  return Linking.openSettings();
}
