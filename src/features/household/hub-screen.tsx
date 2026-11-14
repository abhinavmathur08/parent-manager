import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { DeletionNotice } from '@/features/household/deletion-notice';
import { supabaseConfig } from '@/lib/supabase-config';

type Row = { key: string; title: string; href: Href };

function Rows({ rows }: { rows: readonly Row[] }) {
  return rows.map((row, index) => (
    <ListRow
      key={row.key}
      title={row.title}
      variant="navigation"
      onPress={() => router.push(row.href)}
      divider={index < rows.length - 1}
      testID={`open-${row.key}`}
    />
  ));
}

/**
 * S-25 Household tab: the hub for the household's settings and the member's own account
 * and privacy (FR-PRIV-1). Pantry, notifications and subscription join as they're built.
 */
export function HouseholdHubScreen() {
  const { t } = useTranslation();
  const household: Row[] = [
    { key: 'members', title: t('household.members.title'), href: '/household/members' },
    { key: 'people', title: t('people.title'), href: '/household/people' },
    { key: 'settings', title: t('household.settings.title'), href: '/household/settings' },
  ];
  const you: Row[] = [
    { key: 'privacy', title: t('privacy.title'), href: '/household/privacy' },
    { key: 'account', title: t('account.title'), href: '/household/account' },
  ];
  if (__DEV__) household.push({ key: 'gallery', title: t('gallery.title'), href: '/gallery' });

  return (
    <Screen title={t('tabs.household')} testID="household-screen">
      <DeletionNotice />
      <View>
        <Rows rows={household} />
      </View>
      <View>
        <SectionHeader title={t('householdHub.you')} variant="group" />
        <Rows rows={you} />
      </View>
      <View>
        <SectionHeader title={t('householdHub.about')} variant="group" />
        <ListRow
          title={t('householdHub.version')}
          variant="value"
          value={Constants.expoConfig?.version ?? ''}
          testID="app-version"
        />
        {__DEV__ ? (
          <Text variant="label" color="textSecondary" testID="supabase-status">
            {supabaseConfig
              ? t('home.supabaseStatus.configured')
              : t('home.supabaseStatus.notConfigured')}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
