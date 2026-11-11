import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/components/banner';
import { TAB_BAR_FOOTPRINT } from '@/components/floating-tab-bar';
import { useSyncEngine, useSyncStatus } from '@/lib/sync/provider';

/**
 * Says how many local changes are waiting to sync, until they have (NFR-OFF-3), and tells
 * the user when the server refused some (NFR-OFF-6). Sits just above the tab bar.
 */
export function PendingChangesBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const engine = useSyncEngine();
  const { pending, rejected } = useSyncStatus();
  if (!pending && !rejected) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom: insets.bottom + TAB_BAR_FOOTPRINT }]}
    >
      {rejected ? (
        <Banner
          variant="info"
          message={t('sync.rejected', { count: rejected })}
          onDismiss={() => void engine?.store.acknowledgeRejected()}
          testID="sync-rejected"
        />
      ) : null}
      {pending ? (
        <Banner
          variant="offline"
          message={t('sync.pending', { count: pending })}
          testID="sync-pending"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    start: 0,
    end: 0,
  },
});
