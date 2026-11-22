import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { useEntitlement } from '@/features/subscription/entitlement';
import { usePremiumSheet } from '@/features/subscription/premium-sheet';

import { useDocuments } from './vault-list';

/**
 * Free holds up to 25 documents (D-15, FR2-DOC-8). The server holds the real limit in
 * `documents.limits` and refuses past it; this only saves a parent filling in the form first.
 */
export const FREE_DOCUMENTS = 25;

/**
 * S-40's add action, for parents. At the Free limit it opens the Premium sheet with the
 * `documents` trigger (FR2-PAY-1) instead of S-41.
 */
export function AddDocumentButton({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  const { isPremium } = useEntitlement();
  const { openPremiumSheet } = usePremiumSheet();
  const { documents } = useDocuments();
  const atLimit = !isPremium && documents.length >= FREE_DOCUMENTS;
  return (
    <Button
      label={t('documents.add.action')}
      icon="add"
      onPress={() => (atLimit ? openPremiumSheet('documents') : onAdd())}
      fullWidth
      testID="vault-add"
    />
  );
}
