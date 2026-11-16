import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { useHousehold } from '@/features/household/membership';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatNumber } from '@/i18n';
import { track } from '@/lib/analytics';
import { getSupabase } from '@/lib/supabase';

import { useEntitlement } from './entitlement';
import { usePremiumSheet } from './premium-sheet';

type Allowance = { used: number; allowance: number; resets_on: string };

/**
 * The month's AI import allowance on the import screen (FR-AI-2, FR-AI-10). When it's used
 * up, it shows the reset date and, for a free household, opens the Premium sheet at this
 * moment of need (FR-PAY-5). Manual recipe creation stays available either way.
 */
export function AllowanceNotice() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const household = useHousehold().state;
  const householdId = household.status === 'member' ? household.membership.householdId : null;
  const { isPremium } = useEntitlement();
  const { openPremiumSheet } = usePremiumSheet();
  const [allowance, setAllowance] = useState<Allowance | null>(null);

  useEffect(() => {
    if (!householdId) return;
    let active = true;
    Promise.resolve(getSupabase().rpc('ai_import_allowance'))
      .then(({ data, error }) => {
        const row = (Array.isArray(data) ? data[0] : data) as Allowance | undefined;
        if (!active || error || !row) return;
        setAllowance(row);
        if (row.used >= row.allowance) {
          track('ai_allowance_reached', { tier: isPremium ? 'premium' : 'free' });
        }
      })
      .catch(() => undefined); // Offline: import needs a connection anyway (FR-AI-3).
    return () => {
      active = false;
    };
  }, [householdId, isPremium]);

  if (!allowance) return null;
  const reached = allowance.used >= allowance.allowance;
  const used = t('premium.allowance.used', {
    used: formatNumber(allowance.used, i18n.language),
    total: formatNumber(allowance.allowance, i18n.language),
  });

  if (!reached) {
    return (
      <Text variant="label" color="textSecondary" testID="import-allowance">
        {used}
      </Text>
    );
  }
  return (
    <Card testID="import-allowance-reached">
      <View style={{ gap: theme.space[3] }}>
        <Text>
          {t('premium.allowance.reached', {
            date: formatDate(new Date(`${allowance.resets_on}T12:00:00`), i18n.language),
          })}
        </Text>
        {isPremium ? null : (
          <Button
            variant="secondary"
            label={t('premium.seePremium')}
            onPress={() => openPremiumSheet('ai_allowance')}
            testID="import-see-premium"
          />
        )}
      </View>
    </Card>
  );
}
