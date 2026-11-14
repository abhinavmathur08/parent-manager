import { useCallback, useState } from 'react';

import { isAnalyticsOptedOut, setAnalyticsOptOut } from '@/lib/analytics';

/**
 * This device's analytics choice (FR-PRIV-5). It's stored on the device, not the account,
 * so each of a member's devices is set on its own. Crash reports aren't affected.
 */
export function useAnalyticsSharing(): [sharing: boolean, setSharing: (on: boolean) => void] {
  const [sharing, setLocal] = useState(() => !isAnalyticsOptedOut());
  const setSharing = useCallback((on: boolean) => {
    setLocal(on);
    setAnalyticsOptOut(!on).catch(() => setLocal(!isAnalyticsOptedOut()));
  }, []);
  return [sharing, setSharing];
}
