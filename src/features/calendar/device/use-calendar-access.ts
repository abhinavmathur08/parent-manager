import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { track } from '@/lib/analytics';
import {
  readCalendarAccess,
  requestCalendarAccess,
  type CalendarAccess,
} from '@/lib/device-calendar/permission';

/**
 * The calendar permission, read without asking and again when the app returns (the member
 * may have changed it in the system's Settings). `null` until the first read. `ask` shows the
 * system prompt; call it only from the explain-first sheet (FR2-DEV-1).
 */
export function useCalendarAccess() {
  const [access, setAccess] = useState<CalendarAccess | null>(null);

  const refresh = useCallback(async () => {
    const next = await readCalendarAccess().catch((): CalendarAccess => 'blocked');
    setAccess(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    // No calendar module on this build: the features can't run.
    readCalendarAccess()
      .catch((): CalendarAccess => 'blocked')
      .then((next) => {
        if (active) setAccess(next);
      });
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [refresh]);

  const ask = useCallback(async (): Promise<CalendarAccess> => {
    let next: CalendarAccess;
    try {
      next = await requestCalendarAccess();
    } catch {
      next = 'blocked';
    }
    track('calendar_permission_result', { granted: next === 'granted' });
    setAccess(next);
    return next;
  }, []);

  return { access, refresh, ask };
}
