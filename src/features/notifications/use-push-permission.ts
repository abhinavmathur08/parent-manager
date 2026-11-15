import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { readPushPermission, type PushPermission } from '@/lib/notifications/push';

/**
 * The push permission, read again whenever the app comes back to the foreground, since the
 * member may have changed it in system settings. `null` until the first read.
 */
export function usePushPermission(): [PushPermission | null, () => Promise<PushPermission | null>] {
  const [permission, setPermission] = useState<PushPermission | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await readPushPermission();
      setPermission(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    readPushPermission()
      .then((next) => {
        if (active) setPermission(next);
      })
      .catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [refresh]);

  return [permission, refresh];
}
