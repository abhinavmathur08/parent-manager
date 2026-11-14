import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useRemoteConfig, useUpdateRequired } from '@/features/remote-config/provider';

/** The store page to update from: the configured URL, or the Play listing on Android. */
export function storeUrlFor(
  configured: string | null,
  platform: string,
  androidPackage: string | undefined,
): string | null {
  if (configured) return configured;
  if (platform === 'android' && androidPackage) {
    return `https://play.google.com/store/apps/details?id=${androidPackage}`;
  }
  return null;
}

/** S-01's forced-update screen: blocks the app until it's updated (NFR-REL-4). */
export function ForcedUpdate() {
  const { t } = useTranslation();
  const { storeUrl } = useRemoteConfig();
  const url = storeUrlFor(storeUrl, Platform.OS, Constants.expoConfig?.android?.package);

  // It can replace the app before the root layout hides the splash screen.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <Screen title={t('forcedUpdate.title')} hasTabBar={false} testID="forced-update">
      <Text>{t('forcedUpdate.body')}</Text>
      {url ? (
        <Button
          label={t('forcedUpdate.action')}
          onPress={() => {
            Linking.openURL(url).catch(() => undefined);
          }}
          fullWidth
          testID="forced-update-action"
        />
      ) : (
        <Text color="textSecondary">{t('forcedUpdate.noStore')}</Text>
      )}
    </Screen>
  );
}

/** Shows the forced-update screen in place of the app while this version is too old. */
export function ForcedUpdateGate({ children }: { children: ReactNode }) {
  return useUpdateRequired() ? <ForcedUpdate /> : children;
}
