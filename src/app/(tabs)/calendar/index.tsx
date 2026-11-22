import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AddEventButton } from '@/features/calendar/add-event-button';
import { householdTimeZone } from '@/features/calendar/agenda';
import { AgendaScreen } from '@/features/calendar/agenda-screen';
import { HouseholdBusyDays } from '@/features/calendar/busy-days';
import { useEventEditor } from '@/features/calendar/use-event-editor';
import { useAuth } from '@/features/auth/session';
import { useHousehold, type Membership } from '@/features/household/membership';

export default function CalendarRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  return <Calendar membership={state.membership} />;
}

function Calendar({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const editor = useEventEditor({
    mode: 'add',
    householdId: membership.householdId,
    locale: membership.locale,
    timeZone: householdTimeZone(membership.timezone),
    userId: auth.status === 'signedIn' ? auth.session.user.id : null,
    isParent: membership.role === 'parent',
  });
  return (
    <HouseholdBusyDays
      membership={membership}
      userId={auth.status === 'signedIn' ? auth.session.user.id : null}
    >
      <AgendaScreen
        household={{
          id: membership.householdId,
          locale: membership.locale,
          weekStart: membership.weekStart === 1 ? 1 : 7,
          timezone: membership.timezone ?? null,
        }}
        onOpen={(item) =>
          router.push({
            pathname: '/calendar/[id]',
            params: { id: item.event.id, date: item.occurrence.originalDate },
          })
        }
        footer={<AddEventButton label={t('calendar.add')} onPress={editor.open} />}
        headerActions={[
          {
            label: t('calendarSettings.title'),
            icon: 'settings',
            onPress: () => router.push('/calendar/settings'),
            testID: 'calendar-open-settings-screen',
          },
        ]}
      />
      {editor.sheet}
    </HouseholdBusyDays>
  );
}
