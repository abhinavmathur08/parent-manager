import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/session';
import { revokeInvitation } from '@/features/household/invitations';
import { InviteSheet } from '@/features/household/invite-sheet';
import { MemberSheet } from '@/features/household/member-sheet';
import {
  fetchMembers,
  fetchPendingInvites,
  isExpired,
  type Member,
  type PendingInvite,
} from '@/features/household/members';
import { useHousehold } from '@/features/household/membership';
import { useSeats } from '@/features/household/seats';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/i18n';

type Loaded = { members: Member[]; invites: PendingInvite[] } | 'error' | null;

/** S-26: members with roles and joined dates, and pending invites (FR-HH-9, FR-HH-10). */
export function MembersScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const auth = useAuth();
  const household = useHousehold().state;
  const membership = household.status === 'member' ? household.membership : null;
  const householdId = membership?.householdId ?? null;
  const isParent = membership?.role === 'parent';
  const myId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const { seats } = useSeats(householdId, true);

  const [loaded, setLoaded] = useState<Loaded>(null);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  const [revokeError, setRevokeError] = useState<string>();
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!householdId) return;
    let current = true;
    Promise.all([
      fetchMembers(householdId),
      // Only parents can read invitations (RLS), so others skip the request.
      isParent ? fetchPendingInvites(householdId) : Promise.resolve([]),
    ])
      .then(([members, invites]) => current && setLoaded({ members, invites }))
      .catch(() => current && setLoaded('error'));
    return () => {
      current = false;
    };
  }, [householdId, isParent, version]);

  const nameOf = (member: Member) => member.displayName ?? t('household.members.unnamed');
  const date = (iso: string) => formatDate(new Date(iso), i18n.language);
  const data = loaded !== 'error' ? loaded : null;
  const parents = data?.members.filter((m) => m.role === 'parent').length ?? 0;

  return (
    <Screen
      title={t('household.members.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
      testID="members-screen"
      banner={
        online ? null : (
          <Banner
            variant="offline"
            message={t('household.members.offline')}
            testID="offline-banner"
          />
        )
      }
    >
      {loaded === 'error' ? (
        <View style={{ gap: theme.space[2] }}>
          <Text testID="members-error">{t('auth.errors.network')}</Text>
          <Button
            variant="secondary"
            label={t('household.members.retry')}
            onPress={reload}
            testID="members-retry"
          />
        </View>
      ) : null}
      {data ? (
        <View>
          <SectionHeader title={t('household.members.membersSection')} variant="group" />
          {data.members.map((member, index) => {
            const self = member.userId === myId;
            const role = t(`household.roles.${member.role}`);
            return (
              <ListRow
                key={member.userId}
                title={self ? t('household.members.you', { name: nameOf(member) }) : nameOf(member)}
                subtitle={t('household.members.roleJoined', { role, date: date(member.joinedAt) })}
                variant={isParent && !self ? 'navigation' : 'plain'}
                onPress={isParent && !self ? () => setSelected(member) : undefined}
                divider={index < data.members.length - 1}
                testID={`member-${index}`}
              />
            );
          })}
        </View>
      ) : null}
      {data && isParent ? (
        <View style={{ gap: theme.space[2] }}>
          <SectionHeader title={t('household.members.invitesSection')} variant="group" />
          {data.invites.length === 0 ? (
            <Text color="textSecondary" testID="invites-empty">
              {t('household.members.noInvites')}
            </Text>
          ) : null}
          {data.invites.map((invite, index) => (
            <View
              key={invite.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}
              testID={`invite-${index}`}
            >
              <View style={{ flex: 1 }}>
                <Text>{t(`household.roles.${invite.role}`)}</Text>
                <Text color={isExpired(invite) ? 'error' : 'textSecondary'} variant="label">
                  {t(
                    isExpired(invite) ? 'household.members.expired' : 'household.members.expires',
                    {
                      date: date(invite.expiresAt),
                    },
                  )}
                </Text>
              </View>
              <Button
                variant="ghost"
                label={t('household.members.revoke')}
                disabled={!online}
                onPress={() => {
                  setRevokeError(undefined);
                  revokeInvitation(invite.id)
                    .then(reload)
                    .catch(() => setRevokeError(t('auth.errors.generic')));
                }}
                testID={`invite-${index}-revoke`}
              />
            </View>
          ))}
          {revokeError ? (
            <Text color="error" testID="revoke-error">
              {revokeError}
            </Text>
          ) : null}
          <Button
            label={t('household.invite.open')}
            icon="add"
            onPress={() => setInviting(true)}
            disabled={!online}
            fullWidth
            testID="open-invite"
          />
        </View>
      ) : null}
      {householdId && isParent ? (
        <>
          <InviteSheet visible={inviting} onClose={() => setInviting(false)} onCreated={reload} />
          <MemberSheet
            householdId={householdId}
            member={selected}
            name={selected ? nameOf(selected) : ''}
            parents={parents}
            premium={seats?.premium ?? false}
            online={online}
            onClose={() => setSelected(null)}
            onChanged={reload}
          />
        </>
      ) : null}
    </Screen>
  );
}
