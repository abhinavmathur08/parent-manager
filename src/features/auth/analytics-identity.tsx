import { useEffect } from 'react';

import { useAuth } from '@/features/auth/session';
import { onSignOut } from '@/features/auth/sign-out';
import { useHousehold } from '@/features/household/membership';
import { fetchSeats } from '@/features/household/seats';
import {
  analyticsEnabled,
  identifyAnalyticsUser,
  resetAnalytics,
  setAnalyticsContext,
} from '@/lib/analytics';

// Signing out forgets the user and household on this device, keeping the opt-out (F-07.2).
onSignOut(resetAnalytics);

/**
 * Keeps analytics tied to the signed-in user's ID and their household, role, region, locale
 * and tier (spec section 3.0). Renders nothing.
 */
export function AnalyticsIdentity() {
  const auth = useAuth();
  const { state } = useHousehold();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const membership = state.status === 'member' ? state.membership : null;
  const householdId = membership?.householdId;
  const role = membership?.role;
  const region = membership?.region;
  const locale = membership?.locale;

  useEffect(() => {
    if (userId) identifyAnalyticsUser(userId);
  }, [userId]);

  useEffect(() => {
    if (!analyticsEnabled()) return;
    if (!householdId || !role || !region || !locale) {
      setAnalyticsContext(null);
      return;
    }
    const context = { householdId, role, region, locale };
    setAnalyticsContext(context);
    let active = true;
    fetchSeats(householdId).then(
      (seats) => {
        if (active) setAnalyticsContext({ ...context, tier: seats.premium ? 'premium' : 'free' });
      },
      () => undefined, // Offline: events carry no tier until the next launch.
    );
    return () => {
      active = false;
    };
  }, [householdId, role, region, locale]);

  return null;
}
