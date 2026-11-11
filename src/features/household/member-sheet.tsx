import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { RadioOption } from '@/components/radio-option';
import { Text } from '@/components/text';
import { authErrorKey } from '@/features/auth/auth-errors';
import { MEMBER_ROLES, type MemberRole } from '@/features/household/invitations';
import {
  changeMemberRole,
  memberRefusal,
  removeMember,
  type Member,
} from '@/features/household/members';
import { MAX_PARENTS } from '@/features/household/seats';
import { useTheme } from '@/hooks/use-theme';

/** Whether a member can move to a role, before the server checks again (FR-HH-10, FR-HH-14). */
export function roleChangeAvailability(
  member: Member,
  role: MemberRole,
  parents: number,
  premium: boolean,
): 'available' | 'seat_limit' | 'premium_required' | 'last_parent' {
  if (role === member.role) return 'available';
  const otherParents = parents - (member.role === 'parent' ? 1 : 0);
  if (role === 'parent') return otherParents >= MAX_PARENTS ? 'seat_limit' : 'available';
  if (!premium) return 'premium_required';
  if (member.role === 'parent' && otherParents === 0) return 'last_parent';
  return 'available';
}

export type MemberSheetProps = {
  householdId: string;
  member: Member | null;
  name: string;
  parents: number;
  premium: boolean;
  online: boolean;
  onClose: () => void;
  /** Called after a change is saved, so the list reloads. */
  onChanged: () => void;
};

/** S-26's member actions for a parent: change the role or remove the member. */
export function MemberSheet({
  householdId,
  member,
  name,
  parents,
  premium,
  online,
  onClose,
  onChanged,
}: MemberSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  function close() {
    setConfirming(false);
    setError(undefined);
    onClose();
  }

  async function run(action: () => Promise<void>, closeAfter: boolean) {
    // Changes save at once (design system section 1); the sheet closes on success.
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onChanged();
      if (closeAfter) close();
    } catch (caught) {
      const refusal = memberRefusal(caught);
      setError(
        refusal
          ? t(`household.members.refusals.${refusal}`)
          : t(`auth.errors.${authErrorKey(caught)}`),
      );
    } finally {
      setBusy(false);
    }
  }

  const current = member;
  return (
    <BottomSheet
      visible={current !== null}
      onClose={close}
      title={name}
      testID="member-sheet"
      footer={
        current ? (
          confirming ? (
            <View style={{ gap: theme.space[2] }}>
              <Button
                variant="destructive"
                label={t('household.members.removeConfirm', { name })}
                onPress={() => run(() => removeMember(householdId, current.userId), true)}
                loading={busy}
                disabled={!online || busy}
                fullWidth
                testID="member-remove-confirm"
              />
              <Button
                variant="ghost"
                label={t('household.members.cancel')}
                onPress={() => setConfirming(false)}
                fullWidth
                testID="member-remove-cancel"
              />
            </View>
          ) : (
            <Button
              variant="destructive"
              label={t('household.members.remove')}
              onPress={() => setConfirming(true)}
              disabled={!online || busy}
              fullWidth
              testID="member-remove"
            />
          )
        ) : null
      }
    >
      {current && confirming ? (
        <Text testID="member-remove-warning">{t('household.members.removeWarning', { name })}</Text>
      ) : null}
      {current && !confirming ? (
        <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
          {MEMBER_ROLES.map((role) => {
            const state = roleChangeAvailability(current, role, parents, premium);
            return (
              <RadioOption
                key={role}
                label={t(`household.roles.${role}`)}
                description={
                  state === 'available' ? undefined : t(`household.members.refusals.${state}`)
                }
                selected={current.role === role}
                onPress={() => run(() => changeMemberRole(householdId, current.userId, role), true)}
                disabled={!online || busy || state !== 'available' || current.role === role}
                testID={`member-role-${role}`}
              />
            );
          })}
        </View>
      ) : null}
      {error ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="member-error">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
