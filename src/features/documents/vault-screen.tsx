import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { usePlanPeople } from '@/features/planner/use-plan-people';
import { todayIn, toDate } from '@/features/planner/week';
import { formatDate, type AppLocale } from '@/i18n';

import { usePendingUploads, type PendingUpload } from './pending-uploads';
import type { DocumentRow } from './tables';
import { categoryKey, isExpired, useDocuments, vaultSections } from './vault-list';

export type VaultHousehold = { id: string; locale: AppLocale; timezone: string | null };

export type VaultScreenProps = {
  household: VaultHousehold;
  online: boolean;
  onBack: () => void;
  onOpen: (documentId: string) => void;
  /** The add action, for parents (S-41); absent for family members and caregivers. */
  addAction?: ReactNode;
};

const EXPIRY_FORMAT = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' } as const;

/**
 * S-40 Vault (FR2-DOC-1): the household's documents by category, each with its title, person
 * tag and expiry date, read from the local copy so the list works offline (NFR2-OFF-1).
 * Documents added on this device that haven't uploaded yet show as "waiting to upload".
 * Render it inside `VaultGate`.
 */
export function VaultScreen({ household, online, onBack, onOpen, addAction }: VaultScreenProps) {
  const { t } = useTranslation();
  const { documents, loading } = useDocuments();
  const pending = usePendingUploads(household.id);
  const people = usePlanPeople(household.id).people;
  const today = todayIn(household.timezone);
  const sections = vaultSections(documents, household.locale);

  const personName = (personId: string | null) =>
    personId ? (people.find((p) => p.id === personId)?.displayName ?? null) : null;

  const details = (doc: Pick<DocumentRow, 'person_id' | 'expires_on'>) => {
    const person = personName(doc.person_id);
    const expiry = doc.expires_on
      ? t(isExpired(doc.expires_on, today) ? 'documents.expired' : 'documents.expires', {
          date: formatDate(toDate(doc.expires_on), household.locale, EXPIRY_FORMAT),
        })
      : null;
    if (person && expiry) return t('documents.personAndExpiry', { person, expiry });
    return person ?? expiry ?? undefined;
  };

  const pendingLabel = (item: PendingUpload) =>
    item.state === 'failed'
      ? t('documents.uploadFailed')
      : item.state === 'uploading'
        ? t('documents.uploading')
        : t('documents.waiting');

  const empty = !loading && sections.length === 0 && pending.length === 0;

  return (
    <Screen
      title={t('documents.title')}
      onBack={onBack}
      banner={
        online ? null : (
          <Banner variant="offline" message={t('documents.offline')} testID="vault-offline" />
        )
      }
      testID="vault-screen"
    >
      {addAction}
      {pending.length > 0 ? (
        <View testID="vault-pending">
          <SectionHeader title={t('documents.waitingTitle')} variant="group" />
          {pending.map((item, index) => (
            <ListRow
              key={item.id}
              title={item.title}
              subtitle={pendingLabel(item)}
              leading={<Icon name="clock" color="textSecondary" />}
              divider={index < pending.length - 1}
              testID={`document-pending-${item.id}`}
            />
          ))}
        </View>
      ) : null}
      {sections.map((section) => (
        <View key={section.category} testID={`vault-section-${section.category}`}>
          <SectionHeader title={t(categoryKey(section.category))} variant="group" />
          {section.documents.map((doc, index) => (
            <ListRow
              key={doc.id}
              title={doc.title}
              subtitle={details(doc)}
              variant="navigation"
              leading={<Icon name="document" color="textSecondary" />}
              onPress={() => onOpen(doc.id)}
              divider={index < section.documents.length - 1}
              testID={`document-row-${doc.id}`}
            />
          ))}
        </View>
      ))}
      {empty ? (
        <EmptyState icon="document" message={t('documents.empty')} testID="vault-empty" />
      ) : null}
    </Screen>
  );
}
