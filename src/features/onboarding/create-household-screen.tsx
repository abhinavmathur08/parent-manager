import { getLocales } from 'expo-localization';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { RadioOption } from '@/components/radio-option';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { deviceRegion, REGION_SETTINGS, REGIONS } from '@/features/household/region';
import { MAX_HOUSEHOLD_NAME } from '@/features/onboarding/create-household';
import { useOnboardingDraft } from '@/features/onboarding/draft';
import { useTheme } from '@/hooks/use-theme';
import { displayQuantity, formatDate, formatQuantity, type Region } from '@/i18n';

// A Sunday and a Monday, to name each region's first day of the week in its own locale.
const SUNDAY = new Date(Date.UTC(2026, 10, 8, 12));
const MONDAY = new Date(Date.UTC(2026, 10, 9, 12));
// A pint of milk, in base millilitres, as an example of each region's units.
const EXAMPLE_ML = 473;

function readDeviceRegion(): Region {
  try {
    return deviceRegion(getLocales());
  } catch {
    return 'US';
  }
}

/** How a region shows quantities and weeks, in that region's own locale (FR-ONB-3). */
export function regionDescription(region: Region, t: TFunction) {
  const { locale, unitSystem, weekStart } = REGION_SETTINGS[region];
  const example = formatQuantity(
    displayQuantity(EXAMPLE_ML, 'volume', unitSystem, { liquid: true }),
    locale,
  );
  const day = formatDate(weekStart === 7 ? SUNDAY : MONDAY, locale, {
    weekday: 'long',
    timeZone: 'UTC',
  });
  return t('onboarding.region.description', { example, weekStart: day });
}

/** S-06: household name and region, steps 1 and 2 of creating a household (FR-ONB-2). */
export function CreateHouseholdScreen({ displayName }: { displayName: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [draft, setDraft] = useOnboardingDraft();
  const [error, setError] = useState<string>();
  const [deviceDefault] = useState(readDeviceRegion);

  const defaultName = displayName
    ? t('onboarding.household.defaultName', { name: displayName })
    : t('onboarding.household.defaultNameNoName');
  const householdName = draft.householdName ?? defaultName;
  const region = draft.region ?? deviceDefault;
  const descriptions = useMemo(
    () => Object.fromEntries(REGIONS.map((r) => [r, regionDescription(r, t)])),
    [t],
  );

  // The household is created at the end of step 4, with its people (FR-ONB-2).
  function submit() {
    if (householdName.trim() === '') {
      setError(t('onboarding.household.nameRequired'));
      return;
    }
    setDraft((d) => ({ ...d, householdName, region, step: 'people' }));
    router.push('/people');
  }

  return (
    <Screen
      title={t('onboarding.household.title')}
      onBack={() => {
        setDraft((d) => ({ ...d, step: 'welcome' }));
        if (router.canGoBack()) router.back();
        else router.replace('/welcome');
      }}
      hasTabBar={false}
      testID="create-household-screen"
    >
      <TextField
        label={t('onboarding.household.name')}
        value={householdName}
        error={error}
        onChangeText={(text) => {
          setDraft((d) => ({ ...d, householdName: text }));
          setError(undefined);
        }}
        maxLength={MAX_HOUSEHOLD_NAME}
        autoCapitalize="words"
        returnKeyType="done"
        testID="household-name"
      />
      <View style={{ gap: theme.space[2] }}>
        <Text variant="sectionLabel" accessibilityRole="header">
          {t('onboarding.household.regionTitle')}
        </Text>
        <Text color="textSecondary">{t('onboarding.household.regionSubtitle')}</Text>
      </View>
      <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
        {REGIONS.map((r) => (
          <RadioOption
            key={r}
            label={t(`onboarding.region.${r}`)}
            description={descriptions[r]}
            selected={region === r}
            onPress={() => setDraft((d) => ({ ...d, region: r }))}
            testID={`region-${r}`}
          />
        ))}
      </View>
      <Button
        label={t('onboarding.household.continue')}
        onPress={submit}
        fullWidth
        testID="create-household-continue"
      />
    </Screen>
  );
}
