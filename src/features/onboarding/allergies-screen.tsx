import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { authErrorKey } from '@/features/auth/auth-errors';
import { useHousehold } from '@/features/household/membership';
import { deviceTimeZone } from '@/features/household/region';
import { completeOnboarding, isAlreadyMember } from '@/features/onboarding/create-household';
import { useOnboardingDraft } from '@/features/onboarding/draft';
import {
  defaultName,
  defaultPeople,
  onboardingPayload,
  sanitizePeople,
  toggle,
  type DraftPerson,
} from '@/features/onboarding/people';
import { ageBandKey, hasDietary } from '@/features/people/codes';
import { AllergyDisclaimer, DietaryChips } from '@/features/people/pickers';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';

/**
 * S-08, step 4: allergies and diets for the people entered, from fixed codes, with the
 * not-medical-advice disclaimer (FR-ONB-2, FR-HH-12). Finishing creates the household with
 * everything at once and lands on the Plan tab (FR-ONB-5). Skippable.
 */
export function AllergiesScreen({ displayName }: { displayName: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const { refresh } = useHousehold();
  const [draft, setDraft, clearDraft] = useOnboardingDraft();
  const [error, setError] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const people = sanitizePeople(draft.people) ?? defaultPeople();
  const withDietary = people.filter((p) => hasDietary(p.ageBand));

  const updatePerson = (key: string, change: (p: DraftPerson) => DraftPerson) =>
    setDraft((d) => ({
      ...d,
      people: (sanitizePeople(d.people) ?? defaultPeople()).map((p) =>
        p.key === key ? change(p) : p,
      ),
    }));

  async function finish(skip: boolean) {
    if (finishing) return;
    const name =
      draft.householdName?.trim() ||
      (displayName
        ? t('onboarding.household.defaultName', { name: displayName })
        : t('onboarding.household.defaultNameNoName'));
    setFinishing(true);
    setError(undefined);
    try {
      await completeOnboarding({
        name,
        region: draft.region ?? 'US',
        timezone: deviceTimeZone(),
        people: onboardingPayload(people, displayName, t, !skip),
      });
    } catch (caught) {
      // Already a member: an earlier attempt went through, so onboarding is done.
      if (!isAlreadyMember(caught)) {
        setError(t(`auth.errors.${authErrorKey(caught)}`));
        setFinishing(false);
        return;
      }
    }
    // The household guard moves the app to the Plan tab once the membership is loaded.
    clearDraft();
    await refresh();
    setFinishing(false);
  }

  return (
    <Screen
      title={t('onboarding.allergies.title')}
      onBack={() => {
        setDraft((d) => ({ ...d, step: 'people' }));
        if (router.canGoBack()) router.back();
        else router.replace('/people');
      }}
      hasTabBar={false}
      testID="allergies-screen"
      banner={
        online ? null : (
          <Banner variant="offline" message={t('auth.offline')} testID="offline-banner" />
        )
      }
    >
      <Text color="textSecondary">{t('onboarding.allergies.subtitle')}</Text>
      <AllergyDisclaimer testID="allergy-disclaimer" />
      {withDietary.map((person, index) => (
        <Card key={person.key} testID={`dietary-${index}`} style={{ gap: theme.space[3] }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            {person.name.trim() || defaultName(people, person, displayName, t)}
            <Text color="textSecondary">
              {person.ageBand === 'adult' ? '' : ` · ${t(ageBandKey(person.ageBand))}`}
            </Text>
          </Text>
          <DietaryChips
            allergies={person.allergies}
            diets={person.diets}
            onToggleAllergy={(code) =>
              updatePerson(person.key, (p) => ({ ...p, allergies: toggle(p.allergies, code) }))
            }
            onToggleDiet={(code) =>
              updatePerson(person.key, (p) => ({ ...p, diets: toggle(p.diets, code) }))
            }
            disabled={finishing}
            testID={`dietary-${index}`}
          />
        </Card>
      ))}
      {error ? (
        <Text color="error" accessibilityRole="alert" testID="allergies-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('onboarding.allergies.finish')}
        onPress={() => finish(false)}
        loading={finishing}
        disabled={!online || finishing}
        accessibilityHint={finishing ? t('onboarding.household.creating') : undefined}
        fullWidth
        testID="allergies-finish"
      />
      <Button
        variant="ghost"
        label={t('onboarding.skip')}
        onPress={() => finish(true)}
        disabled={!online || finishing}
        fullWidth
        testID="allergies-skip"
      />
    </Screen>
  );
}
