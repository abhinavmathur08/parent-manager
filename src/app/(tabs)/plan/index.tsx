import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/session';
import { HouseholdBusyDays } from '@/features/calendar/busy-days';
import { useHousehold } from '@/features/household/membership';
import { useInboxBell } from '@/features/notifications/inbox-bell';
import { announceListReady } from '@/features/notifications/list-ready';
import { usePushPrompt } from '@/features/notifications/push-prompt';
import { isPlanDate } from '@/features/planner/week';
import { PlanWeekScreen } from '@/features/planner/week-screen';

export default function PlanRoute() {
  const { t } = useTranslation();
  const { state } = useHousehold();
  const auth = useAuth();
  // The first planned week offers push notifications, in context (FR-NOT-2).
  const pushPrompt = usePushPrompt(auth.status === 'signedIn' ? auth.session.user.id : null);
  // The header bell opens the inbox (S-24).
  const bell = useInboxBell();
  // The Calendar tab's meals row opens a day here (FR2-CAL-5).
  const { date } = useLocalSearchParams<{ date?: string }>();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <HouseholdBusyDays
      membership={membership}
      userId={auth.status === 'signedIn' ? auth.session.user.id : null}
    >
      <PlanWeekScreen
        household={{
          id: membership.householdId,
          locale: membership.locale,
          weekStart: membership.weekStart === 1 ? 1 : 7,
          timezone: membership.timezone ?? null,
        }}
        canWrite={membership.role !== 'caregiver'}
        actions={{
          onWeekPlanned: (start) => {
            pushPrompt.offer();
            // FR-NOT-4: a planned week tells the others its list is ready, unless someone did today.
            void announceListReady(start, 'week_planned').catch(() => undefined);
          },
        }}
        // Recipes moved from the tab bar to the Plan tab's header (D-29, FR3-TASK-1).
        headerActions={[
          {
            icon: 'recipes',
            label: t('plan.openRecipes'),
            onPress: () => router.push('/plan/recipes'),
            testID: 'plan-recipes',
          },
          bell,
        ]}
        focusDate={isPlanDate(date) ? date : null}
      />
      {pushPrompt.sheet}
    </HouseholdBusyDays>
  );
}
