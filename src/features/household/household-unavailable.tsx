import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useHousehold } from '@/features/household/membership';

/** Signed in on a device that has never loaded the household, and offline. */
export function HouseholdUnavailable() {
  const { t } = useTranslation();
  const { refresh } = useHousehold();
  return (
    <Screen
      title={t('onboarding.unavailable.title')}
      hasTabBar={false}
      testID="household-unavailable"
    >
      <Text>{t('onboarding.unavailable.body')}</Text>
      <Button
        label={t('onboarding.unavailable.retry')}
        onPress={() => {
          refresh();
        }}
        fullWidth
        testID="household-retry"
      />
    </Screen>
  );
}
