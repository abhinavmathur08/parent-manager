import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import type { PushPermission } from '@/lib/notifications/push';

export type PushStatusProps = {
  permission: PushPermission | null;
  /** Asks the system for permission (FR-NOT-2: turning push on in settings). */
  onTurnOn: () => void;
  onOpenSystemSettings: () => void;
  asking?: boolean;
};

/**
 * Push status on S-29 (FR-NOT-2). Granted shows "On". Not asked yet offers to turn push on,
 * which asks the system. Denied says push is off in system settings, with a link there.
 */
export function PushStatus({
  permission,
  onTurnOn,
  onOpenSystemSettings,
  asking,
}: PushStatusProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (permission === null) return null;
  if (permission === 'granted') {
    return (
      <ListRow
        title={t('notifications.push.title')}
        variant="value"
        value={t('notifications.push.on')}
        testID="push-status"
      />
    );
  }
  const denied = permission === 'denied';
  return (
    <View style={{ gap: theme.space[3] }} testID="push-status">
      <Text variant="body" testID={denied ? 'push-status-denied' : 'push-status-off'}>
        {denied ? t('notifications.push.offInSystem') : t('notifications.push.offExplainer')}
      </Text>
      {denied ? (
        <Button
          label={t('notifications.push.openSettings')}
          variant="secondary"
          onPress={onOpenSystemSettings}
          testID="push-open-settings"
        />
      ) : (
        <Button
          label={t('notifications.push.turnOn')}
          onPress={onTurnOn}
          loading={asking}
          testID="push-turn-on"
        />
      )}
    </View>
  );
}
