import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { authErrorKey } from '@/features/auth/auth-errors';
import { isLastParent, leaveHousehold } from '@/features/household/leave';
import { useHousehold } from '@/features/household/membership';

/** What leaving means for the caller (FR-HH-8, FR-HH-14). */
export type LeaveKind = 'leave' | 'delete' | 'last_parent';

export function leaveKind(members: number, parents: number, isParent: boolean): LeaveKind {
  if (members <= 1) return 'delete';
  if (isParent && parents <= 1) return 'last_parent';
  return 'leave';
}

export type LeaveSheetProps = {
  visible: boolean;
  householdId: string;
  kind: LeaveKind;
  online: boolean;
  onClose: () => void;
};

/**
 * Leaving the household from S-26. The only member's leaving deletes the household, so the
 * sheet names what goes; the last parent with others is told to promote someone first.
 */
export function LeaveSheet({ visible, householdId, kind, online, onClose }: LeaveSheetProps) {
  const { t } = useTranslation();
  const { refresh } = useHousehold();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function leave() {
    setBusy(true);
    setError(undefined);
    try {
      await leaveHousehold(householdId);
      // The guard moves to create-or-join once the membership is gone.
      await refresh();
    } catch (caught) {
      setError(
        isLastParent(caught)
          ? t('household.leave.last_parent.body')
          : t(`auth.errors.${authErrorKey(caught)}`),
      );
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t(`household.leave.${kind}.title`)}
      testID="leave-sheet"
      footer={
        kind === 'last_parent' ? null : (
          <Button
            variant="destructive"
            label={t(`household.leave.${kind}.action`)}
            onPress={leave}
            loading={busy}
            disabled={!online || busy}
            fullWidth
            testID="leave-confirm"
          />
        )
      }
    >
      <Text testID="leave-body">{t(`household.leave.${kind}.body`)}</Text>
      {error ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="leave-error">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
