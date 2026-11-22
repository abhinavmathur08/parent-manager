import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { usePlanPeople } from '@/features/planner/use-plan-people';
import { toDate } from '@/features/planner/week';
import { formatDate, formatNumber } from '@/i18n';

import { categoryKey, useDocuments } from './vault-list';
import type { VaultHousehold } from './vault-screen';

export type DocumentScreenProps = {
  documentId: string;
  household: VaultHousehold;
  online: boolean;
  onBack: () => void;
  /** The pages, shown only online (S-42). */
  pages?: ReactNode;
};

const DATE_FORMAT = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;

/**
 * S-42 Document viewer: the document's details from the local copy, which read offline, and
 * its pages, which need a connection (FR2-DOC-1). Offline it says so instead of the pages.
 * Render it inside `VaultGate`.
 */
export function DocumentScreen({
  documentId,
  household,
  online,
  onBack,
  pages,
}: DocumentScreenProps) {
  const { t } = useTranslation();
  const { documents, loading } = useDocuments();
  const people = usePlanPeople(household.id).people;
  const doc = documents.find((row) => row.id === documentId) ?? null;

  if (!doc) {
    return (
      <Screen title={t('documents.title')} onBack={onBack} testID="document-screen">
        {loading ? null : (
          <EmptyState icon="document" message={t('documents.gone')} testID="document-gone" />
        )}
      </Screen>
    );
  }

  const person = doc.person_id ? people.find((p) => p.id === doc.person_id)?.displayName : null;
  const rows: { key: string; title: string; value: string }[] = [
    {
      key: 'category',
      title: t('documents.details.category'),
      value: t(categoryKey(doc.category)),
    },
    ...(person ? [{ key: 'person', title: t('documents.details.person'), value: person }] : []),
    ...(doc.expires_on
      ? [
          {
            key: 'expiry',
            title: t('documents.details.expiry'),
            value: formatDate(toDate(doc.expires_on), household.locale, DATE_FORMAT),
          },
        ]
      : []),
    {
      key: 'pages',
      title: t('documents.details.pages'),
      value: formatNumber(doc.page_count, household.locale),
    },
  ];

  return (
    <Screen
      title={doc.title}
      onBack={onBack}
      banner={
        online ? null : (
          <Banner variant="offline" message={t('documents.offline')} testID="document-offline" />
        )
      }
      testID="document-screen"
    >
      {online ? (
        pages
      ) : (
        <EmptyState
          icon="offline"
          message={t('documents.openOffline')}
          testID="document-offline-message"
        />
      )}
      <Card testID="document-details">
        <View>
          {rows.map((row, index) => (
            <ListRow
              key={row.key}
              title={row.title}
              variant="value"
              value={row.value}
              divider={index < rows.length - 1}
              testID={`document-detail-${row.key}`}
            />
          ))}
        </View>
      </Card>
    </Screen>
  );
}
