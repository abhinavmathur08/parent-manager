import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';

import { AddDocumentScreen } from '@/features/documents/add-document-screen';
import { attachDocument } from '@/features/documents/attachments';
import { VaultGate } from '@/features/documents/vault/vault-gate';
import { useHousehold } from '@/features/household/membership';
import { useOnline } from '@/hooks/use-online';
import { useSyncWriter } from '@/lib/sync';

/** S-41 from an event (FR2-DOC-5): the new document is attached once it's stored. Parents only. */
export default function AddEventDocumentRoute() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { state } = useHousehold();
  const online = useOnline();
  const writer = useSyncWriter();
  if (state.status !== 'member' || state.membership.role !== 'parent') return null;
  const { membership } = state;
  return (
    <VaultGate>
      <AddDocumentScreen
        household={{
          id: membership.householdId,
          locale: membership.locale,
          timezone: membership.timezone ?? null,
        }}
        online={online}
        afterAdded={(documentId) => attachDocument(writer, eventId, documentId, randomUUID)}
        onDone={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))}
      />
    </VaultGate>
  );
}
