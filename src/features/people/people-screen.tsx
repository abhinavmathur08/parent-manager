import { router, useFocusEffect } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/session';
import { nameKey } from '@/features/ingredients/catalog-ids';
import { ageBandKey, dietKey } from '@/features/people/codes';
import {
  addPerson,
  dietaryChanges,
  fetchCanEdit,
  fetchPeople,
  removePerson,
  setDietary,
  updatePerson,
  type Person,
} from '@/features/people/data';
import { PersonSheet, type PersonDraft } from '@/features/people/person-sheet';
import { AllergyDisclaimer } from '@/features/people/pickers';
import { formatList, type AppLocale } from '@/i18n';

type Editing = { person: Person | undefined } | null;

/** The person's age band and codes, in the locale's list format. */
function summary(person: Person, t: TFunction, locale: AppLocale): string {
  const codes = [
    ...person.allergies.map((c) => t(nameKey(c))),
    ...person.diets.map((c) => t(dietKey(c))),
  ];
  const band = t(ageBandKey(person.ageBand));
  if (codes.length === 0) return band;
  return t('people.summary', { band, codes: formatList(codes, locale) });
}

/**
 * S-28: the people the household feeds, with age bands, diets and allergies from fixed codes
 * and the not-medical-advice disclaimer (FR-HH-11, FR-HH-12). Always free (FR-PAY-10).
 * Parents and family members edit; caregivers read.
 */
export function PeopleProfilesScreen({
  householdId,
  locale,
}: {
  householdId: string;
  locale: AppLocale;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const [people, setPeople] = useState<Person[]>();
  const [canEdit, setCanEdit] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    try {
      const [list, editable] = await Promise.all([
        fetchPeople(householdId),
        userId ? fetchCanEdit(householdId, userId) : Promise.resolve(false),
      ]);
      setPeople(list);
      setCanEdit(editable);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [householdId, userId]);

  // Reload on each visit, so a partner's changes show up.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function save(draft: PersonDraft) {
    const before = editing?.person;
    const input = {
      displayName: draft.displayName,
      ageBand: draft.ageBand,
      dueMonth: draft.dueMonth,
    };
    let personId: string;
    if (before) {
      personId = before.id;
      await updatePerson(personId, input);
    } else {
      personId = await addPerson(householdId, input);
    }
    const changes = dietaryChanges(
      householdId,
      personId,
      before ?? { allergies: [], diets: [] },
      draft,
    );
    for (const change of changes) await setDietary(change);
    setEditing(null);
    await load();
  }

  async function remove() {
    if (!editing?.person) return;
    await removePerson(editing.person.id);
    setEditing(null);
    await load();
  }

  return (
    <Screen
      title={t('people.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
      testID="people-profiles"
    >
      <AllergyDisclaimer testID="people-disclaimer" />
      {loadFailed ? (
        <Text color="error" accessibilityRole="alert" testID="people-load-error">
          {t('people.loadFailed')}
        </Text>
      ) : null}
      {people === undefined && !loadFailed ? <Skeleton count={3} testID="people-loading" /> : null}
      {people?.length === 0 ? (
        <EmptyState icon="people" message={t('people.empty')} testID="people-empty" />
      ) : null}
      {people?.map((person, index) => (
        <ListRow
          key={person.id}
          title={person.displayName}
          subtitle={summary(person, t, locale)}
          variant={canEdit ? 'navigation' : 'plain'}
          onPress={canEdit ? () => setEditing({ person }) : undefined}
          divider={index < people.length - 1}
          testID={`person-${index}`}
        />
      ))}
      {canEdit ? (
        <Button
          variant="secondary"
          label={t('people.add')}
          onPress={() => setEditing({ person: undefined })}
          fullWidth
          testID="people-add"
        />
      ) : null}
      {editing ? (
        <PersonSheet
          key={editing.person?.id ?? 'new'}
          person={editing.person}
          locale={locale}
          onSave={save}
          onRemove={remove}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}
