import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { SectionHeader } from '@/components/section-header';
import { useTheme } from '@/hooks/use-theme';

import { useEventAttachments } from './attachments';

export type EventAttachmentsProps = {
  eventId: string;
  locale: string;
  /** Parents attach and detach (spec section 2, V5). */
  isParent: boolean;
  /** Opens the event's attachment list behind the vault lock. */
  onOpen: () => void;
  /** Opens the attach screen behind the vault lock. */
  onAttach: () => void;
};

/**
 * S-38's attachments (FR2-DOC-5): only a count of the documents on an event this member can
 * see, with one row that opens their list behind the vault lock. Titles and categories (which
 * may say "Medical") never show here, outside the lock (SR2-L4). A family member or caregiver
 * sees only the ones shared with them (R2-ACC-1); with none, the section isn't there at all.
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
  const count = useEventAttachments(eventId, locale).length;
  if (!isParent && count === 0) return null;
  return (
    <View style={{ gap: theme.space[2] }} testID="event-attachments">
      <SectionHeader title={t('calendar.detail.attachments')} variant="group" />
      {count > 0 ? (
        <ListRow
          title={t('calendar.detail.openDocuments')}
          subtitle={t('calendar.detail.documentCount', { count })}
          variant="navigation"
          leading={<Icon name="document" color="textSecondary" />}
          onPress={onOpen}
          testID="event-attachments-open"
        />
      ) : null}
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
