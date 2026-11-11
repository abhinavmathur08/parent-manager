import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/session';
import { signOut } from '@/features/auth/sign-out';
import { markRemovalSeen } from '@/features/household/access-lost';
import { leaveHousehold } from '@/features/household/leave';
import { useHousehold } from '@/features/household/membership';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';

export type AccessEndedProps = {
  reason: 'removed' | 'paused';
  householdId: string;
  householdName: string;
};

/**
 * S-35: shown when access ends. A removed member can go on to create or join a household;
 * a paused one can ask a parent to renew Premium, check again, or leave (spec section 2.x,
 * FR-PAY-9). The device's copy of household data is already cleared.
 */
export function AccessEnded({ reason, householdId, householdName }: AccessEndedProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const auth = useAuth();
  const { refresh } = useHousehold();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await refresh();
    } catch {
      setError(t('auth.errors.generic'));
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t(`household.accessEnded.${reason}.title`, { name: householdName })}
      hasTabBar={false}
      testID="access-ended"
    >
      <Text testID="access-ended-body">{t(`household.accessEnded.${reason}.body`)}</Text>
      <View style={{ gap: theme.space[2] }}>
        {reason === 'removed' ? (
          <Button
            label={t('household.accessEnded.createOrJoin')}
            onPress={() =>
              act(async () => {
                if (userId) markRemovalSeen(userId, householdId);
              })
            }
            loading={busy}
            fullWidth
            testID="access-ended-continue"
          />
        ) : (
          <>
            <Button
              label={t('household.accessEnded.checkAgain')}
              onPress={() => act(async () => undefined)}
              loading={busy}
              disabled={!online}
              fullWidth
              testID="access-ended-retry"
            />
            {confirmLeave ? (
              <Text testID="access-ended-leave-warning">
                {t('household.accessEnded.leaveWarning', { name: householdName })}
              </Text>
            ) : null}
            <Button
              variant={confirmLeave ? 'destructive' : 'secondary'}
              label={
                confirmLeave
                  ? t('household.accessEnded.leaveConfirm', { name: householdName })
                  : t('household.accessEnded.leave')
              }
              onPress={() =>
                confirmLeave ? act(() => leaveHousehold(householdId)) : setConfirmLeave(true)
              }
              disabled={!online || busy}
              fullWidth
              testID="access-ended-leave"
            />
          </>
        )}
        <Button
          variant="ghost"
          label={t('auth.signOut.action')}
          onPress={() => {
            signOut().catch(() => undefined);
          }}
          fullWidth
          testID="access-ended-sign-out"
        />
      </View>
      {error ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="access-ended-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
