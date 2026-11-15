import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { policyUrlForLanguage, type PolicyKind } from '@/constants/policy-links';
import { shareExport, type ExportScope } from '@/features/account/export';
import { useAnalyticsSharing } from '@/features/account/use-analytics-opt-out';
import { useOnline } from '@/hooks/use-online';
import { reportError } from '@/lib/crash-reporting';

const POLICIES: readonly PolicyKind[] = ['privacy', 'terms'];

export type PrivacyHousehold = {
  id: string;
  /** Only parents export the household (spec 2.2, row 35). */
  isParent: boolean;
};

/**
 * S-30 Privacy and data: data export (FR-PRIV-2, always free), the analytics opt-out and
 * policy links (FR-PRIV-5, FR-PRIV-6). Export needs a connection, so it's off offline.
 */
export function PrivacyScreen({ household }: { household?: PrivacyHousehold | null } = {}) {
  const { t, i18n } = useTranslation();
  const [sharing, setSharing] = useAnalyticsSharing();
  const online = useOnline();
  const [exporting, setExporting] = useState<ExportScope | null>(null);
  const [exportError, setExportError] = useState(false);

  const runExport = async (scope: ExportScope) => {
    if (!household || exporting) return;
    setExporting(scope);
    setExportError(false);
    try {
      await shareExport({
        scope,
        householdId: household.id,
        dialogTitle: t('privacy.export.share'),
      });
    } catch (error) {
      reportError(error);
      setExportError(true);
    } finally {
      setExporting(null);
    }
  };
  const scopes: ExportScope[] = household?.isParent ? ['household', 'account'] : ['account'];

  return (
    <Screen
      title={t('privacy.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
      testID="privacy-screen"
    >
      {household ? (
        <View testID="privacy-export">
          <SectionHeader title={t('privacy.export.title')} variant="group" />
          {scopes.map((scope, index) => (
            <ListRow
              key={scope}
              title={t(`privacy.export.${scope}`)}
              subtitle={
                !online
                  ? t('privacy.export.offline')
                  : exporting === scope
                    ? t('privacy.export.preparing')
                    : t(`privacy.export.${scope}Detail`)
              }
              variant="navigation"
              onPress={() => void runExport(scope)}
              disabled={!online || exporting !== null}
              divider={index < scopes.length - 1}
              testID={`privacy-export-${scope}`}
            />
          ))}
          {exportError ? (
            <Text color="error" accessibilityLiveRegion="polite" testID="privacy-export-error">
              {t('privacy.export.failed')}
            </Text>
          ) : null}
        </View>
      ) : null}
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
