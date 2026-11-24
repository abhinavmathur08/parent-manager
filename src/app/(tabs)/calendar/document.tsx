import { router, useLocalSearchParams } from 'expo-router';

import { DocumentViewerRoute } from '@/features/documents/document-route';

/** S-42, from an event's attachments (S-38, FR2-DOC-5), in the Calendar tab's stack. */
export default function EventDocumentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <DocumentViewerRoute
      documentId={id}
      onOpenEvent={(eventId) =>
        router.push({ pathname: '/calendar/[id]', params: { id: eventId } })
      }
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))}
    />
  );
}
