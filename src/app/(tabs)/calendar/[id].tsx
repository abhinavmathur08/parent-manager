import { router, useLocalSearchParams } from 'expo-router';

import { householdTimeZone } from '@/features/calendar/agenda';
import { EventDetailScreen } from '@/features/calendar/event-detail-screen';
import { useEventEditor } from '@/features/calendar/use-event-editor';
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
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const timeZone = householdTimeZone(membership.timezone);
  const editor = useEventEditor({
    mode: 'edit',
    householdId: membership.householdId,
    locale: membership.locale,
    timeZone,
    userId,
    isParent: membership.role === 'parent',
  });
  return (
    <>
      <EventDetailScreen
        eventId={id}
        date={isPlanDate(date) ? date : null}
        household={{ id: membership.householdId, locale: membership.locale, timeZone }}
        role={membership.role}
        userId={userId}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))}
        onEdit={editor.edit}
      />
      {editor.sheet}
    </>
  );
}
