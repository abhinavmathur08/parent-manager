import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { signOut } from '@/features/auth/sign-out';

import { beforeSignOut, hasCopies } from './copy-sync';

/**
 * Signs out, first asking whether to remove this device's copies from the phone's calendar
 * (FR2-PRIV-4). Keeping them is the default; Cancel stays signed in.
 */
export async function signOutAskingAboutCopies(t: TFunction): Promise<void> {
  if (hasCopies()) {
    const remove = await new Promise<boolean | null>((resolve) => {
      Alert.alert(
        t('calendarSettings.signOut.title'),
        t('calendarSettings.signOut.body'),
        [
          {
            text: t('calendarSettings.signOut.cancel'),
            style: 'cancel',
            onPress: () => resolve(null),
          },
          {
            text: t('calendarSettings.signOut.remove'),
            style: 'destructive',
            onPress: () => resolve(true),
          },
          {
            text: t('calendarSettings.signOut.keep'),
            isPreferred: true,
            onPress: () => resolve(false),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
    });
    if (remove === null) return;
    await beforeSignOut(remove);
  }
  await signOut();
}
