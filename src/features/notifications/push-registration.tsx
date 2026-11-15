import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { onSignOut } from '@/features/auth/sign-out';
import { registerPushToken, unregisterPushToken } from '@/lib/notifications/push';

// Notifications that arrive while the app is open show as a banner, silently (FR-NOT-6).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Sign-out removes this device's token, so the next account on it isn't sent this one's
// notifications (FR-AUTH-7).
onSignOut(unregisterPushToken);

/** Registering refreshes `last_seen_at`; once every few hours is plenty. */
const REFRESH_MS = 6 * 60 * 60 * 1000;
let registeredAt = 0;

async function refreshRegistration(force = false) {
  if (!force && Date.now() - registeredAt < REFRESH_MS) return;
  if (await registerPushToken()) registeredAt = Date.now();
}

/**
 * Keeps this device's push token registered for the signed-in member (N-01.1). It never asks
 * for permission: it only registers when permission is already granted, at launch, when the
 * app returns to the foreground and when the token changes.
 */
export function PushRegistration() {
  useEffect(() => {
    void refreshRegistration(true);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshRegistration();
    });
    const tokens = Notifications.addPushTokenListener(() => {
      // The listener gets the device token; the Expo token is fetched again from it.
      void refreshRegistration(true);
    });
    return () => {
      appState.remove();
      tokens.remove();
    };
  }, []);
  return null;
}
