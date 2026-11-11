import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { REGION_SETTINGS } from '@/features/household/region';
import { useOnboardingDraft } from '@/features/onboarding/draft';
import {
  defaultName,
  defaultPeople,
  isChild,
  MAX_ONBOARDING_PEOPLE,
  MAX_PERSON_NAME,
  newPerson,
  sanitizePeople,
  withAgeBand,
  type DraftPerson,
} from '@/features/onboarding/people';
import { type ChildAgeBand } from '@/features/people/codes';
import { AgeBandChips, DueMonthChips } from '@/features/people/pickers';
import { useTheme } from '@/hooks/use-theme';

/**
 * S-07, step 3: who you're feeding (FR-ONB-2). Adults, prefilled with the user, and children
 * by age band only, asking "Expecting, or how old is your youngest?" with the due month only
 * for expecting (FR-ONB-4, D-6). Skippable.
 */
export function PeopleScreen({ displayName }: { displayName: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [draft, setDraft] = useOnboardingDraft();
  const people = sanitizePeople(draft.people) ?? defaultPeople();
  const locale = REGION_SETTINGS[draft.region ?? 'US'].locale;
  const adults = people.filter((p) => !isChild(p));
  const children = people.filter(isChild);
  const full = people.length >= MAX_ONBOARDING_PEOPLE;

  const setPeople = (update: (previous: DraftPerson[]) => DraftPerson[]) =>
    setDraft((d) => ({ ...d, people: update(sanitizePeople(d.people) ?? defaultPeople()) }));
  const updatePerson = (key: string, change: (p: DraftPerson) => DraftPerson) =>
    setPeople((list) => list.map((p) => (p.key === key ? change(p) : p)));
  const removePerson = (key: string) => setPeople((list) => list.filter((p) => p.key !== key));

  function next(skip: boolean) {
    setDraft((d) => ({ ...d, people: skip ? null : d.people, step: 'allergies' }));
    router.push('/allergies');
  }

  function nameField(person: DraftPerson, label: string, testID: string) {
    return (
      <TextField
        label={label}
        value={person.name}
        placeholder={defaultName(people, person, displayName, t)}
        onChangeText={(name) => updatePerson(person.key, (p) => ({ ...p, name }))}
        maxLength={MAX_PERSON_NAME}
        autoCapitalize="words"
        testID={testID}
      />
    );
  }

  return (
    <Screen
      title={t('onboarding.people.title')}
      onBack={() => {
        setDraft((d) => ({ ...d, step: 'create-household' }));
        if (router.canGoBack()) router.back();
        else router.replace('/create-household');
      }}
      hasTabBar={false}
      testID="people-screen"
    >
      <Text color="textSecondary">{t('onboarding.people.subtitle')}</Text>

      <Text variant="sectionLabel" accessibilityRole="header">
        {t('onboarding.people.adults')}
      </Text>
      {adults.map((person, index) => (
        <View
          key={person.key}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}
        >
          <View style={{ flex: 1 }}>
            {nameField(
              person,
              person.isSelf ? t('onboarding.people.you') : t('onboarding.people.adultLabel'),
              `adult-${index}-name`,
            )}
          </View>
          {person.isSelf ? null : (
            <IconButton
              icon="close"
              accessibilityLabel={t('onboarding.people.remove', {
                name: person.name.trim() || defaultName(people, person, displayName, t),
              })}
              onPress={() => removePerson(person.key)}
              testID={`adult-${index}-remove`}
            />
          )}
        </View>
      ))}
      <Button
        variant="secondary"
        label={t('onboarding.people.addAdult')}
        onPress={() => setPeople((list) => [...list, newPerson('adult')])}
        disabled={full}
        testID="add-adult"
      />

      <Text variant="sectionLabel" accessibilityRole="header">
        {t('onboarding.people.children')}
      </Text>
      {children.map((person, index) => (
        <Card key={person.key} testID={`child-${index}`} style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            <View style={{ flex: 1 }}>
              {nameField(person, t('onboarding.people.childLabel'), `child-${index}-name`)}
            </View>
            <IconButton
              icon="close"
              accessibilityLabel={t('onboarding.people.remove', {
                name: person.name.trim() || defaultName(people, person, displayName, t),
              })}
              onPress={() => removePerson(person.key)}
              testID={`child-${index}-remove`}
            />
          </View>
          <AgeBandChips
            label={t('people.ageBand')}
            value={person.ageBand as ChildAgeBand}
            onChange={(band) => updatePerson(person.key, (p) => withAgeBand(p, band))}
            testID={`child-${index}-band`}
          />
          {person.ageBand === 'expecting' ? (
            <DueMonthChips
              value={person.dueMonth}
              onChange={(dueMonth) => updatePerson(person.key, (p) => ({ ...p, dueMonth }))}
              locale={locale}
              testID={`child-${index}-due`}
            />
          ) : null}
        </Card>
      ))}
      {full ? null : (
        <AgeBandChips
          label={
            children.length === 0
              ? t('onboarding.people.youngestQuestion')
              : t('onboarding.people.anotherChild')
          }
          value={null}
          onChange={(band) => setPeople((list) => [...list, withAgeBand(newPerson(band), band)])}
          testID="add-child"
        />
      )}

      <Button
        label={t('onboarding.people.continue')}
        onPress={() => next(false)}
        fullWidth
        testID="people-continue"
      />
      <Button
        variant="ghost"
        label={t('onboarding.skip')}
        onPress={() => next(true)}
        fullWidth
        testID="people-skip"
      />
    </Screen>
  );
}
