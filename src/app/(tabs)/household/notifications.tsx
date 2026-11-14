import { useAuth } from '@/features/auth/session';
import { useHousehold } from '@/features/household/membership';
import { NotificationsScreen } from '@/features/notifications/notifications-screen';

export default function NotificationsRoute() {
  const auth = useAuth();
  const { state } = useHousehold();
  if (auth.status !== 'signedIn' || state.status !== 'member') return null;
  const { membership } = state;
  return (
    <NotificationsScreen
      userId={auth.session.user.id}
      household={{
        weekStart: membership.weekStart,
        // A membership cached before the timezone was saved falls back to the device's.
        timezone: membership.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      }}
    />
  );
}
