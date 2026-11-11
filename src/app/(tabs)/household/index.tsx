import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { Text } from '@/components/text';
import { signOut } from '@/features/auth/sign-out';
import { LockSettingsSection } from '@/features/biometric/lock-settings';
import { InviteSheet } from '@/features/household/invite-sheet';
import { useHousehold } from '@/features/household/membership';
import { supabaseConfig } from '@/lib/supabase-config';

// Placeholder until the household feature from docs/backlog.md lands.
export default function HouseholdScreen() {
  const { t } = useTranslation();
  const household = useHousehold().state;
  const isParent = household.status === 'member' && household.membership.role === 'parent';
  const [inviting, setInviting] = useState(false);
  return (
    <PlaceholderScreen title={t('tabs.household')} icon="household" testID="household-screen">
      <Card testID="household-status">
        <Text variant="label" color="textSecondary" testID="supabase-status">
          {supabaseConfig
            ? t('home.supabaseStatus.configured')
            : t('home.supabaseStatus.notConfigured')}
        </Text>
      </Card>
      <ListRow
        title={t('people.title')}
        variant="navigation"
        onPress={() => router.push('/household/people')}
        testID="open-people"
      />
      {/* Moves to the members screen (S-26, H-04.1). Only parents invite (FR-HH-1). */}
      {isParent ? (
        <Button
          label={t('household.invite.open')}
          icon="add"
          onPress={() => setInviting(true)}
          fullWidth
          testID="open-invite"
        />
      ) : null}
      {__DEV__ ? (
        <ListRow
          title={t('gallery.title')}
          variant="navigation"
          onPress={() => router.push('/gallery')}
          testID="open-gallery"
        />
      ) : null}
      {/* The lock and sign-out move to the Account screen (S-31) when it's built. */}
      <LockSettingsSection />
      <Button
        variant="secondary"
        label={t('auth.signOut.action')}
        onPress={() => {
          signOut().catch(() => undefined);
        }}
        fullWidth
        testID="sign-out"
      />
      <InviteSheet visible={inviting} onClose={() => setInviting(false)} />
    </PlaceholderScreen>
  );
}
