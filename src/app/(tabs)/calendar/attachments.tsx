import { router, useLocalSearchParams } from 'expo-router';

import { EventAttachmentsScreen } from '@/features/documents/event-attachments-screen';
import { VaultGate } from '@/features/documents/vault/vault-gate';
import { useHousehold } from '@/features/household/membership';

/** An event's attachments, from S-38, behind the vault lock (FR2-DOC-5, SR2-L4). */
export default function EventAttachmentsRoute() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  return (
    <VaultGate>
      <EventAttachmentsScreen
        eventId={eventId}
        locale={state.membership.locale}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))}
        onOpen={(documentId) =>
          router.push({ pathname: '/calendar/document', params: { id: documentId } })
        }
      />
    </VaultGate>
  );
}
