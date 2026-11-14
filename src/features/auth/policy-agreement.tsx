import * as Linking from 'expo-linking';
import { Trans, useTranslation } from 'react-i18next';

import { Text } from '@/components/text';
import { policyUrlForLanguage, type PolicyKind } from '@/constants/policy-links';

function PolicyLink({ kind, children }: { kind: PolicyKind; children?: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const url = policyUrlForLanguage(kind, i18n.language);
  if (!url) return <Text variant="caption">{children}</Text>;
  return (
    <Text
      variant="caption"
      color="primary"
      accessibilityRole="link"
      accessibilityLabel={t(
        kind === 'terms' ? 'auth.policy.termsLabel' : 'auth.policy.privacyLabel',
      )}
      onPress={() => Linking.openURL(url)}
      style={{ textDecorationLine: 'underline' }}
      testID={`policy-${kind}`}
    >
      {children}
    </Text>
  );
}

/** "By continuing you agree to the Terms and Privacy Policy", with links (FR-PRIV-6). */
export function PolicyAgreement() {
  return (
    <Text variant="caption" color="textSecondary" style={{ textAlign: 'center' }}>
      <Trans
        i18nKey="auth.policy.agreement"
        components={{
          terms: <PolicyLink kind="terms" />,
          privacy: <PolicyLink kind="privacy" />,
        }}
      />
    </Text>
  );
}
