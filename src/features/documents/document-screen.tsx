import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Toast } from '@/components/toast';
import { usePlanPeople } from '@/features/planner/use-plan-people';
import { useUndoable } from '@/features/planner/use-undoable';
import { toDate } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatNumber } from '@/i18n';
import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { sendOutDocument } from './send-out';
import { DOCUMENTS } from './tables';
import { categoryKey, useDocuments } from './vault-list';
import type { VaultHousehold } from './vault-screen';

export type DocumentScreenProps = {
  documentId: string;
  household: VaultHousehold;
  online: boolean;
  onBack: () => void;
  /** The pages, shown only online (S-42). */
  pages?: ReactNode;
  /** The events it's attached to. */
  events?: ReactNode;
  /** Who it's shared with, for parents (FR2-DOC-6). */
  sharing?: ReactNode;
  /** Parents can send it out and delete it (FR2-DOC-9, FR2-DOC-10). */
  isParent: boolean;
};

const DATE_FORMAT = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;

/**
 * S-42 Document viewer: the document's details from the local copy, which read offline, and
 * its pages, which need a connection (FR2-DOC-1). Offline it says so instead of the pages.
 * Parents can save or send it out through the share sheet, free on every plan (FR2-DOC-9),
 * and delete it after a confirmation, with a 5-second undo (FR2-DOC-10). Render it inside
 * `VaultGate`.
 */
export function DocumentScreen({
  documentId,
  household,
  online,
  onBack,
  pages,
  events,
  sharing,
  isParent,
}: DocumentScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { documents, loading } = useDocuments();
  const people = usePlanPeople(household.id).people;
  const writer = useSyncWriter();
  const undoable = useUndoable(() => Alert.alert(t('documents.viewer.deleteFailed')));
  const [deleted, setDeleted] = useState(false);
  const [sending, setSending] = useState(false);
  const doc = documents.find((row) => row.id === documentId) ?? null;

  if (!doc || deleted) {
    return (
      <View style={styles.grow}>
        <Screen title={t('documents.title')} onBack={onBack} testID="document-screen">
          {loading || deleted ? null : (
            <EmptyState icon="document" message={t('documents.gone')} testID="document-gone" />
          )}
        </Screen>
        <Toast
          visible={undoable.current !== null}
          message={undoable.current?.message ?? ''}
          variant="undo"
          actionLabel={t('documents.viewer.undo')}
          onAction={() => {
            undoable.undo();
            setDeleted(false);
          }}
          onDismiss={() => {
            undoable.settle();
            onBack();
          }}
          testID="document-undo"
        />
      </View>
    );
  }

  const sendOut = async () => {
    setSending(true);
    try {
      await sendOutDocument(doc.id, t('documents.viewer.sendOut'));
    } catch {
      Alert.alert(t('documents.viewer.sendOutFailed'));
    } finally {
      setSending(false);
    }
  };

  /** The server then removes it from every event and share, and its files (R2-DOC-4). */
  const remove = () =>
    Alert.alert(t('documents.viewer.deleteTitle'), t('documents.viewer.deleteBody'), [
      { text: t('documents.viewer.cancel'), style: 'cancel' },
      {
        text: t('documents.viewer.delete'),
        style: 'destructive',
        onPress: () => {
          setDeleted(true);
          undoable.hold({
            message: t('documents.viewer.deleted'),
            hidden: [doc.id],
            commit: async () => {
              await writer.remove(DOCUMENTS.name, doc.id);
              track('document_deleted', {});
            },
          });
        },
      },
    ]);

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
      {events}
      {sharing}
      {isParent ? (
        <View style={{ gap: theme.space[2] }}>
          <Button
            label={t('documents.viewer.sendOut')}
            icon="share"
            variant="secondary"
            onPress={sendOut}
            loading={sending}
            disabled={!online}
            fullWidth
            testID="document-send-out"
          />
          <Button
            label={t('documents.viewer.delete')}
            variant="destructive"
            onPress={remove}
            fullWidth
            testID="document-delete"
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ grow: { flex: 1 } });
