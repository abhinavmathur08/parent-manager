import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { SectionHeader } from '@/components/section-header';
import { useCalendarRows } from '@/features/calendar/data';
import { toDate } from '@/features/planner/week';
import { formatDate, type AppLocale } from '@/i18n';
import { useSyncedRows } from '@/lib/sync';

import { EVENT_DOCUMENTS, type EventDocumentRow } from './tables';

const DATE_FORMAT = { weekday: 'short', month: 'short', day: 'numeric' } as const;

/**
 * The events a document is attached to (S-42, FR2-DOC-5), from the local copy. Only events
 * the member can see are there (R2-ACC-1), so nothing hidden is listed.
 */
export function LinkedEvents({
  documentId,
  locale,
  timeZone,
  onOpen,
}: {
  documentId: string;
  locale: AppLocale;
  timeZone: string;
  onOpen: (eventId: string) => void;
}) {
  const { t } = useTranslation();
  const links = useSyncedRows<EventDocumentRow>(EVENT_DOCUMENTS.name).rows;
  const { events } = useCalendarRows();
  const linked = useMemo(() => {
    const ids = new Set(
      links.filter((l) => !l.deleted_at && l.document_id === documentId).map((l) => l.event_id),
    );
    return events
      .filter((event) => ids.has(event.id))
      .map((event) => ({
        event,
        sort: event.starts_at ?? event.start_date ?? '',
        when: event.starts_at
          ? formatDate(new Date(event.starts_at), locale, { ...DATE_FORMAT, timeZone })
          : event.start_date
            ? formatDate(toDate(event.start_date), locale, { ...DATE_FORMAT, timeZone: 'UTC' })
            : undefined,
      }))
      .sort((a, b) => a.sort.localeCompare(b.sort));
  }, [links, events, documentId, locale, timeZone]);

  if (linked.length === 0) return null;
  return (
    <View testID="document-events">
      <SectionHeader title={t('documents.viewer.events')} variant="group" />
      {linked.map(({ event, when }, index) => (
        <ListRow
          key={event.id}
          title={event.title}
          subtitle={when}
          variant="navigation"
          leading={<Icon name="calendar" color="textSecondary" />}
          onPress={() => onOpen(event.id)}
          divider={index < linked.length - 1}
          testID={`document-event-${event.id}`}
        />
      ))}
    </View>
  );
}
