import { router, useLocalSearchParams } from 'expo-router';

import { AttachDocumentsScreen } from '@/features/documents/attach-screen';
import { VaultGate } from '@/features/documents/vault/vault-gate';
import { useHousehold } from '@/features/household/membership';

/** Attach documents to an event, from S-38 (FR2-DOC-5). Parents only (V5). */
export default function AttachDocumentsRoute() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { state } = useHousehold();
  if (state.status !== 'member' || state.membership.role !== 'parent') return null;
  return (
    <VaultGate>
      <AttachDocumentsScreen
        eventId={eventId}
        locale={state.membership.locale}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))}
        onAddNew={() => router.push({ pathname: '/calendar/add-document', params: { eventId } })}
      />
    </VaultGate>
  );
}
