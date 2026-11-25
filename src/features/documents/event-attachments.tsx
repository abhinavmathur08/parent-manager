import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { SectionHeader } from '@/components/section-header';
import { useTheme } from '@/hooks/use-theme';

import { useEventAttachments } from './attachments';
import { categoryKey } from './vault-list';

export type EventAttachmentsProps = {
  eventId: string;
  locale: string;
  /** Parents attach and detach (spec section 2, V5). */
  isParent: boolean;
  /** Opens S-42 behind the vault lock. */
  onOpen: (documentId: string) => void;
  /** Opens the attach screen behind the vault lock. */
  onAttach: () => void;
};

/**
 * S-38's attachments (FR2-DOC-5): the documents on an event this member can see, each
 * opening the viewer after the vault lock. A family member or caregiver sees only the ones
 * shared with them (R2-ACC-1); with none, the section isn't there at all.
 */
export function EventAttachments({
  eventId,
  locale,
  isParent,
  onOpen,
  onAttach,
}: EventAttachmentsProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const documents = useEventAttachments(eventId, locale);
  if (!isParent && documents.length === 0) return null;
  return (
    <View style={{ gap: theme.space[2] }} testID="event-attachments">
      <SectionHeader title={t('calendar.detail.attachments')} variant="group" />
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
      {isParent ? (
        <Button
          variant="secondary"
          icon="document"
          label={t('calendar.detail.attach')}
          onPress={onAttach}
          fullWidth
          testID="event-attach"
        />
      ) : null}
    </View>
  );
}
