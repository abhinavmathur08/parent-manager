import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';

import { Banner } from '@/components/banner';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { RadioOption } from '@/components/radio-option';
import { Text } from '@/components/text';
import { authErrorKey } from '@/features/auth/auth-errors';
import { inviteLink } from '@/features/household/invite-link';
import {
  createInvitation,
  createRefusal,
  MEMBER_ROLES,
  type CreatedInvitation,
  type MemberRole,
} from '@/features/household/invitations';
import { useHousehold } from '@/features/household/membership';
import { roleAvailability, useSeats } from '@/features/household/seats';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/i18n';

export type InviteSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** S-10's "invite your partner" opens the sheet with the parent role chosen. */
  initialRole?: MemberRole;
  /** Called after an invitation is created, so a list of pending invites can reload. */
  onCreated?: () => void;
};

/** S-27: choose a role, then share or copy the code and link (FR-HH-1, FR-HH-3). */
export function InviteSheet({
  visible,
  onClose,
  initialRole = 'parent',
  onCreated,
}: InviteSheetProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const household = useHousehold().state;
  const householdId = household.status === 'member' ? household.membership.householdId : null;
  const { seats, failed } = useSeats(householdId, visible);
  const [role, setRole] = useState<MemberRole>(initialRole);
  const [invite, setInvite] = useState<CreatedInvitation | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const availability = seats ? roleAvailability(seats, role) : null;

  function close() {
    onClose();
    setInvite(null);
    setError(undefined);
    setCopied(false);
    setRole(initialRole);
  }

  async function create() {
    if (!householdId) return;
    setCreating(true);
    setError(undefined);
    try {
      setInvite(await createInvitation(householdId, role));
      onCreated?.();
    } catch (caught) {
      const refusal = createRefusal(caught);
      setError(
        refusal
          ? t(`household.invite.unavailable.${refusal}`)
          : t(`auth.errors.${authErrorKey(caught)}`),
      );
    } finally {
      setCreating(false);
    }
  }

  const link = invite ? inviteLink(invite.token) : null;
  const message = invite
    ? link
      ? t('household.invite.shareMessageWithLink', {
          asRole: t(`household.invite.asRole.${invite.role}`),
          code: invite.code,
          link,
        })
      : t('household.invite.shareMessage', {
          asRole: t(`household.invite.asRole.${invite.role}`),
          code: invite.code,
        })
    : '';

  const footer = invite ? (
    <View style={{ gap: theme.space[2] }}>
      <Button
        label={t('household.invite.share')}
        icon="share"
        onPress={() => {
          Share.share({ message }).catch(() => undefined);
        }}
        fullWidth
        testID="invite-share"
      />
      <Button
        variant="secondary"
        label={copied ? t('household.invite.copied') : t('household.invite.copy')}
        onPress={() => {
          Clipboard.setStringAsync(message)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
        fullWidth
        testID="invite-copy"
      />
    </View>
  ) : (
    <Button
      label={t('household.invite.create')}
      onPress={create}
      loading={creating}
      disabled={!online || creating || availability !== 'available'}
      fullWidth
      testID="invite-create"
    />
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={t('household.invite.title')}
      footer={footer}
      testID="invite-sheet"
    >
      <View style={{ gap: theme.space[4] }}>
        {online ? null : (
          <Banner
            variant="offline"
            message={t('household.invite.offline')}
            testID="invite-offline"
          />
        )}
        {failed ? (
          <Text color="error" testID="invite-seats-error">
            {t('auth.errors.network')}
          </Text>
        ) : null}
        {invite ? (
          <Card testID="invite-result">
            <Text color="textSecondary">{t('household.invite.codeLabel')}</Text>
            <Text
              variant="screenTitle"
              tabular
              selectable
              accessibilityLabel={t('household.invite.codeA11y', {
                code: invite.code.split('').join(' '),
              })}
              testID="invite-code"
            >
              {invite.code}
            </Text>
            <Text color="textSecondary" testID="invite-expiry">
              {t('household.invite.expires', {
                date: formatDate(new Date(invite.expiresAt), i18n.language),
                forRole: t(`household.invite.forRole.${invite.role}`),
              })}
            </Text>
          </Card>
        ) : (
          <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
            {MEMBER_ROLES.map((r) => {
              const state = seats ? roleAvailability(seats, r) : 'available';
              return (
                <RadioOption
                  key={r}
                  label={t(`household.roles.${r}`)}
                  description={
                    state === 'available'
                      ? t(`household.invite.roleDescription.${r}`)
                      : t(`household.invite.unavailable.${state}`)
                  }
                  selected={role === r}
                  onPress={() => {
                    setRole(r);
                    setError(undefined);
                  }}
                  disabled={creating || state === 'seat_limit'}
                  testID={`invite-role-${r}`}
                />
              );
            })}
          </View>
        )}
        {!invite && availability === 'premium_required' ? (
          <Card variant="highlight" testID="invite-upgrade">
            <Text variant="cardTitle">{t('household.invite.upgradeTitle')}</Text>
            <Text>{t('household.invite.upgradeBody')}</Text>
          </Card>
        ) : null}
        {error ? (
          <Text color="error" accessibilityLiveRegion="polite" testID="invite-error">
            {error}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
