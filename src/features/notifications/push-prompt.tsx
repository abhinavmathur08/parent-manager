import Storage from 'expo-sqlite/kv-store';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { readPushPermission, requestPushPermission } from '@/lib/notifications/push';

const offeredKey = (userId: string) => `notifications.prompt_offered.${userId}`;

function wasOffered(userId: string): boolean {
  try {
    return Storage.getItemSync(offeredKey(userId)) !== null;
  } catch {
    return false;
  }
}

function markOffered(userId: string): void {
  try {
    Storage.setItemSync(offeredKey(userId), '1');
  } catch {
    // Without storage the offer may come again after the next planned week.
  }
}

/**
 * The in-context push prompt (FR-NOT-2, FR-ONB-8): the first time a member finishes a planned
 * week, a sheet explains what they'd get before the system asks. It's offered once per
 * member on this device, and only while the system can still ask; after "Not now" the
 * member can turn notifications on in settings.
 *
 * Returns `offer`, to call when the member's own change plans the week, and the sheet to render.
 */
export function usePushPrompt(userId: string | null): { offer: () => void; sheet: ReactNode } {
  const { t } = useTranslation();
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [asking, setAsking] = useState(false);

  const offer = useCallback(() => {
    if (!userId || wasOffered(userId)) return;
    void (async () => {
      try {
        if ((await readPushPermission()) !== 'undetermined') return;
      } catch {
        return;
      }
      markOffered(userId);
      setVisible(true);
    })();
  }, [userId]);

  const turnOn = async () => {
    setAsking(true);
    try {
      await requestPushPermission('week_planned', t('notifications.channelName'));
    } catch {
      // A failed request leaves notifications off; settings can try again.
    } finally {
      setAsking(false);
      setVisible(false);
    }
  };

  const sheet = (
    <BottomSheet
      visible={visible}
      onClose={() => setVisible(false)}
      title={t('notifications.prompt.title')}
      testID="push-prompt"
      footer={
        <View style={[styles.actions, { gap: theme.space[2] }]}>
          <Button
            label={t('notifications.prompt.turnOn')}
            onPress={() => void turnOn()}
            loading={asking}
            fullWidth
            testID="push-prompt-turn-on"
          />
          <Button
            label={t('notifications.prompt.notNow')}
            variant="ghost"
            onPress={() => setVisible(false)}
            disabled={asking}
            fullWidth
            testID="push-prompt-not-now"
          />
        </View>
      }
    >
      <Text variant="body" testID="push-prompt-body">
        {t('notifications.prompt.body')}
      </Text>
    </BottomSheet>
  );

  return { offer, sheet };
}

const styles = StyleSheet.create({
  actions: {
    alignSelf: 'stretch',
  },
});
