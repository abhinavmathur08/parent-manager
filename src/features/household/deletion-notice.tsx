import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { fetchDeletionRequest, type DeletionRequest } from '@/features/household/deletion-request';
import { useHousehold } from '@/features/household/membership';
import { formatDate } from '@/i18n';

/**
 * Tells every member on the Household tab that a parent asked to delete the household
 * (FR-PRIV-7). Parents open the screen to confirm or call it off. Push notifications for
 * this come with N-01.
 */
export function DeletionNotice() {
  const { t, i18n } = useTranslation();
  const { state } = useHousehold();
  const membership = state.status === 'member' ? state.membership : null;
  const householdId = membership?.householdId ?? null;
  const [request, setRequest] = useState<DeletionRequest | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!householdId) return;
      let current = true;
      fetchDeletionRequest(householdId)
        .then((next) => current && setRequest(next))
        .catch(() => undefined);
      return () => {
        current = false;
      };
    }, [householdId]),
  );

  if (!request || !membership) return null;
  const message = t('household.delete.notice', {
    date: formatDate(new Date(request.expiresAt), i18n.language),
  });
  const isParent = membership.role === 'parent';
  return (
    <Card
      variant="highlight"
      onPress={isParent ? () => router.push('/household/delete-household') : undefined}
      accessibilityLabel={isParent ? message : undefined}
      testID="deletion-notice"
    >
      <Text>{message}</Text>
    </Card>
  );
}
