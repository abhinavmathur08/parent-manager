import { router } from 'expo-router';

import { VaultGate } from '@/features/documents/vault/vault-gate';
import { VaultScreen } from '@/features/documents/vault-screen';
import { useHousehold } from '@/features/household/membership';
import { useOnline } from '@/hooks/use-online';
import { track } from '@/lib/analytics';

/** S-40, from the Household tab (FR2-DOC-1). */
export default function VaultRoute() {
  const { state } = useHousehold();
  const online = useOnline();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <VaultGate onUnlocked={(via) => track('vault_opened', { unlocked_with: via })}>
      <VaultScreen
        household={{
          id: membership.householdId,
          locale: membership.locale,
          timezone: membership.timezone ?? null,
        }}
        online={online}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
        onOpen={(id) => router.push({ pathname: '/household/documents/[id]', params: { id } })}
      />
    </VaultGate>
  );
}
