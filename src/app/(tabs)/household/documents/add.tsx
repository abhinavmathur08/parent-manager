import { router } from 'expo-router';

import { AddDocumentScreen } from '@/features/documents/add-document-screen';
import { VaultGate } from '@/features/documents/vault/vault-gate';
import { useHousehold } from '@/features/household/membership';
import { useOnline } from '@/hooks/use-online';

/** S-41, from the vault (S-40). Parents only (V-02.2: only parents can add). */
export default function AddDocumentRoute() {
  const { state } = useHousehold();
  const online = useOnline();
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
        onDone={() => (router.canGoBack() ? router.back() : router.replace('/household/documents'))}
      />
    </VaultGate>
  );
}
