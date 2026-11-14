import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useSyncEngine, useSyncOpening, useSyncStatus } from '@/lib/sync/provider';

/**
 * The first load on a new device (A-01.3, FR-AUTH-8): while the household downloads for the
 * first time, a loading state stands in for the tabs, which then open on the Plan tab. If
 * the device is offline, it says so and offers to try again; after that first load the app
 * works offline as usual (NFR-OFF-1).
 */
export function FirstLoadGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const opening = useSyncOpening();
  const engine = useSyncEngine();
  const { firstLoad, state } = useSyncStatus();

  if (!opening && !firstLoad) return children;

  if (firstLoad && state === 'offline') {
    return (
      <Screen
        title={t('sync.firstLoad.offlineTitle')}
        hasTabBar={false}
        testID="first-load-offline"
      >
        <Text>{t('sync.firstLoad.offlineBody')}</Text>
        <Button
          label={t('sync.firstLoad.retry')}
          onPress={() => {
            void engine?.sync();
          }}
          fullWidth
          testID="first-load-retry"
        />
      </Screen>
    );
  }

  return (
    <Screen title={t('sync.firstLoad.title')} hasTabBar={false} testID="first-load">
      <Text accessibilityLiveRegion="polite">{t('sync.firstLoad.body')}</Text>
      <Skeleton variant="card" count={3} testID="first-load-skeleton" />
    </Screen>
  );
}
