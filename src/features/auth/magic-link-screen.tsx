import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { completeMagicLink, parseMagicLink } from '@/features/auth/email-sign-in';
import { clearPendingSignIn } from '@/features/auth/pending-sign-in';

/** Where the magic link in the sign-in email lands (FR-AUTH-2). */
export function MagicLinkScreen() {
  const { t } = useTranslation();
  const url = Linking.useLinkingURL();
  const result = useMemo(() => parseMagicLink(url), [url]);
  const [sessionFailed, setSessionFailed] = useState(false);
  const failed = sessionFailed || result.kind === 'error' || (!!url && result.kind === 'none');

  useEffect(() => {
    if (result.kind !== 'session') return;
    completeMagicLink(result.accessToken, result.refreshToken)
      .then(() => {
        clearPendingSignIn();
        router.replace('/');
      })
      .catch(() => setSessionFailed(true));
  }, [result]);

  return (
    <Screen
      title={t(failed ? 'auth.callback.backToSignIn' : 'auth.callback.checking')}
      hasTabBar={false}
      testID="magic-link-screen"
    >
      {failed ? (
        <>
          <Text>{t('auth.callback.failed')}</Text>
          <Button
            label={t('auth.callback.backToSignIn')}
            onPress={() => router.replace('/')}
            fullWidth
            testID="magic-link-back"
          />
        </>
      ) : null}
    </Screen>
  );
}
