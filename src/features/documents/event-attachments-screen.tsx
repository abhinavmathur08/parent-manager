import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';

import { useEventAttachments } from './attachments';
import { categoryKey } from './vault-list';

export type EventAttachmentsScreenProps = {
  eventId: string;
  locale: string;
  onBack: () => void;
  /** Opens S-42. */
  onOpen: (documentId: string) => void;
};

/**
 * The documents attached to an event that this member can see, by title and category, from
 * S-38's "Open documents" row (FR2-DOC-5, SR2-L4). Render it inside `VaultGate`, since titles
 * and categories are vault content.
 */
export function EventAttachmentsScreen({
  eventId,
  locale,
  onBack,
  onOpen,
}: EventAttachmentsScreenProps) {
  const { t } = useTranslation();
  const documents = useEventAttachments(eventId, locale);
  return (
    <Screen
      title={t('documents.eventAttachments.title')}
      onBack={onBack}
      testID="event-attachments-list"
    >
      {documents.map((doc, index) => (
        <ListRow
          key={doc.id}
          title={doc.title}
          subtitle={t(categoryKey(doc.category))}
          variant="navigation"
          leading={<Icon name="document" color="textSecondary" />}
          onPress={() => onOpen(doc.id)}
          divider={index < documents.length - 1}
          testID={`event-attachment-${doc.id}`}
        />
      ))}
      {documents.length === 0 ? (
        <EmptyState
          icon="document"
          message={t('documents.eventAttachments.empty')}
          testID="event-attachments-empty"
        />
      ) : null}
    </Screen>
  );
}
