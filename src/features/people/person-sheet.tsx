import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { toggle, withAgeBand } from '@/features/onboarding/people';
import { AGE_BANDS, hasDietary, type AgeBand } from '@/features/people/codes';
import type { Person } from '@/features/people/data';
import {
  AgeBandChips,
  AllergyDisclaimer,
  DietaryChips,
  DueMonthChips,
} from '@/features/people/pickers';
import { useTheme } from '@/hooks/use-theme';
import type { AppLocale } from '@/i18n';

const MAX_NAME = 100;

export type PersonDraft = Omit<Person, 'id'>;

const EMPTY: PersonDraft = {
  displayName: '',
  ageBand: 'toddler',
  dueMonth: null,
  allergies: [],
  diets: [],
};

/**
 * The S-28 editor: name, age band, the due month for expecting, and allergies and diets with
 * the disclaimer (FR-HH-11, FR-HH-12). `person` is undefined when adding.
 */
export function PersonSheet({
  person,
  locale,
  onSave,
  onRemove,
  onClose,
}: {
  person: Person | undefined;
  locale: AppLocale;
  onSave: (draft: PersonDraft) => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [draft, setDraft] = useState<PersonDraft>(person ?? EMPTY);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch {
      setError(t('people.saveFailed'));
      setBusy(false);
    }
  }

  function save() {
    if (draft.displayName.trim() === '') {
      setError(t('people.nameRequired'));
      return;
    }
    void run(() => onSave(draft));
  }

  function confirmRemove() {
    const name = person?.displayName ?? '';
    Alert.alert(t('people.removeTitle', { name }), t('people.removeBody'), [
      { text: t('people.cancel'), style: 'cancel' },
      { text: t('people.remove'), style: 'destructive', onPress: () => void run(onRemove) },
    ]);
  }

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={person ? t('people.editTitle') : t('people.addTitle')}
      variant="form"
      testID="person-sheet"
      footer={
        <Button
          label={t('people.save')}
          onPress={save}
          loading={busy}
          disabled={busy}
          fullWidth
          testID="person-save"
        />
      }
    >
      <View style={{ gap: theme.space[4] }}>
        <TextField
          label={t('people.name')}
          hint={t('people.nameHint')}
          value={draft.displayName}
          onChangeText={(displayName) => setDraft((d) => ({ ...d, displayName }))}
          maxLength={MAX_NAME}
          autoCapitalize="words"
          disabled={busy}
          testID="person-name"
        />
        <AgeBandChips<AgeBand>
          label={t('people.ageBand')}
          bands={AGE_BANDS}
          value={draft.ageBand}
          onChange={(band) => setDraft((d) => withAgeBand(d, band))}
          disabled={busy}
          testID="person-band"
        />
        {draft.ageBand === 'expecting' ? (
          <DueMonthChips
            value={draft.dueMonth}
            onChange={(dueMonth) => setDraft((d) => ({ ...d, dueMonth }))}
            locale={locale}
            disabled={busy}
            testID="person-due"
          />
        ) : null}
        {hasDietary(draft.ageBand) ? (
          <>
            <AllergyDisclaimer testID="person-disclaimer" />
            <DietaryChips
              allergies={draft.allergies}
              diets={draft.diets}
              onToggleAllergy={(code) =>
                setDraft((d) => ({ ...d, allergies: toggle(d.allergies, code) }))
              }
              onToggleDiet={(code) => setDraft((d) => ({ ...d, diets: toggle(d.diets, code) }))}
              disabled={busy}
              testID="person"
            />
          </>
        ) : null}
        {error ? (
          <Text color="error" accessibilityRole="alert" testID="person-error">
            {error}
          </Text>
        ) : null}
        {person ? (
          <Button
            variant="destructive"
            label={t('people.remove')}
            onPress={confirmRemove}
            disabled={busy}
            fullWidth
            testID="person-remove"
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}
