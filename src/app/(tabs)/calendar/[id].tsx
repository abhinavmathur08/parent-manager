import { router, useLocalSearchParams } from 'expo-router';

import { householdTimeZone } from '@/features/calendar/agenda';
import { EventDetailScreen } from '@/features/calendar/event-detail-screen';
import { useAuth } from '@/features/auth/session';
import { useHousehold, type Membership } from '@/features/household/membership';
import { isPlanDate } from '@/features/planner/week';

/** S-38, opened from the agenda with the occurrence's original date. */
export default function EventDetailRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  return <Detail membership={state.membership} />;
}

function Detail({ membership }: { membership: Membership }) {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const auth = useAuth();
  return (
    <EventDetailScreen
      eventId={id}
      date={isPlanDate(date) ? date : null}
      household={{
        id: membership.householdId,
        locale: membership.locale,
        timeZone: householdTimeZone(membership.timezone),
      }}
      role={membership.role}
      userId={auth.status === 'signedIn' ? auth.session.user.id : null}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))}
    />
  );
}
