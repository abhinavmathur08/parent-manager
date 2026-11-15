import { useHousehold } from '@/features/household/membership';
import { HistoryScreen } from '@/features/planner/history-screen';

export default function HistoryRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <HistoryScreen
      household={{
        locale: membership.locale,
        weekStart: membership.weekStart === 1 ? 1 : 7,
        timezone: membership.timezone ?? null,
      }}
    />
  );
}
