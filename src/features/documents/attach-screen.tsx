import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Button } from '@/components/button';
import { CheckboxMark } from '@/components/checkbox';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { useSyncedRows, useSyncWriter } from '@/lib/sync';

import { AddDocumentButton } from './add-button';
import { applyAttachmentChanges, liveAttachments } from './attachments';
import { EVENT_DOCUMENTS, type EventDocumentRow } from './tables';
import { categoryKey, useDocuments, vaultSections } from './vault-list';

export type AttachDocumentsScreenProps = {
  eventId: string;
  locale: string;
  onBack: () => void;
  /** S-41, attaching the new document to this event once it's stored. */
  onAddNew: () => void;
};

/**
 * Attach or detach documents on an event, for parents (FR2-DOC-5, spec section 2, V5): the
 * vault's documents by category with a tick each, plus adding a new one. Only the ticks the
 * parent changes are written. Render it inside `VaultGate`, since it lists the vault.
 */
export function AttachDocumentsScreen({
  eventId,
  locale,
  onBack,
  onAddNew,
}: AttachDocumentsScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { documents, loading } = useDocuments();
  const links = useSyncedRows<EventDocumentRow>(EVENT_DOCUMENTS.name).rows;
  const writer = useSyncWriter();
  const [changes, setChanges] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [saving, setSaving] = useState(false);
  const live = liveAttachments(links, eventId);
  const sections = vaultSections(documents, locale);
  const ticked = (id: string) => changes.get(id) ?? live.has(id);

  const toggle = (id: string) =>
    setChanges((current) => new Map(current).set(id, !(current.get(id) ?? live.has(id))));

  const save = async () => {
    setSaving(true);
    try {
      const attached = await applyAttachmentChanges(writer, eventId, links, changes, randomUUID);
      // No category, title or person (FR2-DOC-11).
      for (let i = 0; i < attached; i += 1) track('document_attached', {});
      onBack();
    } catch {
      Alert.alert(t('documents.attach.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen title={t('documents.attach.title')} onBack={onBack} testID="attach-documents">
      <AddDocumentButton onAdd={onAddNew} />
      {sections.map((section) => (
        <View key={section.category} testID={`attach-section-${section.category}`}>
          <SectionHeader title={t(categoryKey(section.category))} variant="group" />
          {section.documents.map((doc, index) => (
            <ListRow
              key={doc.id}
              title={doc.title}
              leading={<CheckboxMark checked={ticked(doc.id)} />}
              onPress={() => toggle(doc.id)}
              accessibilityHint={t(
                ticked(doc.id) ? 'documents.attach.detachHint' : 'documents.attach.attachHint',
              )}
              divider={index < section.documents.length - 1}
              testID={`attach-document-${doc.id}`}
            />
          ))}
        </View>
      ))}
      {!loading && sections.length === 0 ? (
        <EmptyState icon="document" message={t('documents.attach.empty')} testID="attach-empty" />
      ) : null}
      {sections.length > 0 ? (
        <View style={{ paddingTop: theme.space[2] }}>
          <Button
            label={t('documents.attach.save')}
            onPress={save}
            loading={saving}
            disabled={changes.size === 0}
            fullWidth
            testID="attach-save"
          />
        </View>
      ) : null}
    </Screen>
  );
}
