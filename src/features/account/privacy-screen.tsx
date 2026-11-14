import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Switch } from '@/components/switch';
import { policyUrlForLanguage, type PolicyKind } from '@/constants/policy-links';
import { useAnalyticsSharing } from '@/features/account/use-analytics-opt-out';

const POLICIES: readonly PolicyKind[] = ['privacy', 'terms'];

/** S-30 Privacy and data: the analytics opt-out and policy links (FR-PRIV-5, FR-PRIV-6). */
export function PrivacyScreen() {
  const { t, i18n } = useTranslation();
  const [sharing, setSharing] = useAnalyticsSharing();

  return (
    <Screen
      title={t('privacy.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
      testID="privacy-screen"
    >
      <View>
        <SectionHeader title={t('privacy.usage.title')} variant="group" />
        <Switch
          label={t('privacy.usage.share')}
          description={t('privacy.usage.description')}
          value={sharing}
          onValueChange={setSharing}
          testID="analytics-switch"
        />
      </View>
      <View>
        <SectionHeader title={t('privacy.policies.title')} variant="group" />
        {POLICIES.map((kind, index) => {
          const url = policyUrlForLanguage(kind, i18n.language);
          return (
            <ListRow
              key={kind}
              title={t(`privacy.policies.${kind}`)}
              subtitle={url ? undefined : t('privacy.policies.unavailable')}
              variant="navigation"
              onPress={url ? () => void Linking.openURL(url) : undefined}
              disabled={!url}
              divider={index < POLICIES.length - 1}
              testID={`privacy-policy-${kind}`}
            />
          );
        })}
      </View>
    </Screen>
  );
}
