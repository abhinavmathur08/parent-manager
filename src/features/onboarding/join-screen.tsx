import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';

/**
 * S-09's entry point. Joining by invite code needs the invitations backend (H-03.1) and
 * screen (H-03.3); invite links wait for the domain (D-2). Until then this explains that.
 */
export function JoinScreen() {
  const { t } = useTranslation();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/welcome'));
  return (
    <Screen title={t('onboarding.join.title')} onBack={back} hasTabBar={false} testID="join-screen">
      <Text>{t('onboarding.join.body')}</Text>
      <Button label={t('onboarding.join.back')} onPress={back} fullWidth testID="join-back" />
    </Screen>
  );
}
