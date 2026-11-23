import { router, useLocalSearchParams } from 'expo-router';

import { DocumentPages } from '@/features/documents/document-pages';
import { DocumentScreen } from '@/features/documents/document-screen';
import { VaultGate } from '@/features/documents/vault/vault-gate';
import { useHousehold } from '@/features/household/membership';
import { useOnline } from '@/hooks/use-online';

/** S-42, from the vault (S-40). */
export default function DocumentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useHousehold();
  const online = useOnline();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <VaultGate>
      <DocumentScreen
        documentId={id}
        household={{
          id: membership.householdId,
          locale: membership.locale,
          timezone: membership.timezone ?? null,
        }}
        online={online}
        pages={<DocumentPages documentId={id} locale={membership.locale} online={online} />}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/household/documents'))}
      />
    </VaultGate>
  );
}
