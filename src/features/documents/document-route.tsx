import { householdTimeZone } from '@/features/calendar/agenda';
import { useHousehold } from '@/features/household/membership';
import { useOnline } from '@/hooks/use-online';

import { DocumentPages } from './document-pages';
import { DocumentScreen } from './document-screen';
import { LinkedEvents } from './linked-events';
import { VaultGate } from './vault/vault-gate';

/**
 * S-42 behind the vault lock, for the routes that open it: from the vault (S-40) and from an
 * event's attachments (S-38).
 */
export function DocumentViewerRoute({
  documentId,
  onBack,
  onOpenEvent,
}: {
  documentId: string;
  onBack: () => void;
  onOpenEvent: (eventId: string) => void;
}) {
  const { state } = useHousehold();
  const online = useOnline();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <VaultGate>
      <DocumentScreen
        documentId={documentId}
        household={{
          id: membership.householdId,
          locale: membership.locale,
          timezone: membership.timezone ?? null,
        }}
        online={online}
        pages={<DocumentPages documentId={documentId} locale={membership.locale} online={online} />}
        events={
          <LinkedEvents
            documentId={documentId}
            locale={membership.locale}
            timeZone={householdTimeZone(membership.timezone)}
            onOpen={onOpenEvent}
          />
        }
        isParent={membership.role === 'parent'}
        onBack={onBack}
      />
    </VaultGate>
  );
}
