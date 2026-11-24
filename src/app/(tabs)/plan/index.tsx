import { useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/features/auth/session';
import { HouseholdBusyDays } from '@/features/calendar/busy-days';
import { useHousehold } from '@/features/household/membership';
import { useInboxBell } from '@/features/notifications/inbox-bell';
import { announceListReady } from '@/features/notifications/list-ready';
import { usePushPrompt } from '@/features/notifications/push-prompt';
import { isPlanDate } from '@/features/planner/week';
import { PlanWeekScreen } from '@/features/planner/week-screen';

export default function PlanRoute() {
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
        headerActions={[bell]}
        focusDate={isPlanDate(date) ? date : null}
      />
      {pushPrompt.sheet}
    </HouseholdBusyDays>
  );
}
