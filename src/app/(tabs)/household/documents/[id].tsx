import { router, useLocalSearchParams } from 'expo-router';

import { DocumentViewerRoute } from '@/features/documents/document-route';

/** S-42, from the vault (S-40). */
export default function DocumentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <DocumentViewerRoute
      documentId={id}
      onOpenEvent={(eventId) =>
        router.push({ pathname: '/calendar/[id]', params: { id: eventId } })
      }
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household/documents'))}
    />
  );
}
