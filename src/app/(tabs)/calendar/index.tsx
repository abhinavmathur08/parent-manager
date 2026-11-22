import { AgendaScreen } from '@/features/calendar/agenda-screen';
import { useHousehold } from '@/features/household/membership';

export default function CalendarRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <AgendaScreen
      household={{
        id: membership.householdId,
        locale: membership.locale,
        weekStart: membership.weekStart === 1 ? 1 : 7,
        timezone: membership.timezone ?? null,
      }}
    />
  );
}
