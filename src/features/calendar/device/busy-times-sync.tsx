import 'expo-sqlite/localStorage/install';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { reportError } from '@/lib/crash-reporting';
import { readCalendarAccess } from '@/lib/device-calendar/permission';
import { getSupabase } from '@/lib/supabase';
import { useSyncedRows, useSyncEngine, useSyncStatus, useSyncWriter } from '@/lib/sync';

import { BUSY_BLOCKS, type BusyBlockRow } from '../tables';
import { refreshBusyTimes } from './busy-sync';
import {
  BUSY_TIMES_KEY,
  DEFAULT_BUSY_TIMES,
  parseBusyTimes,
  type BusyTimesConfig,
} from './busy-times';

/** The window and refresh limit (R2-PAY-1): cached, then the server's, else the defaults. */
function useBusyTimesConfig(): BusyTimesConfig {
  const [config, setConfig] = useState<BusyTimesConfig>(() => {
    try {
      const cached = globalThis.localStorage?.getItem(BUSY_TIMES_KEY);
      return cached ? parseBusyTimes(JSON.parse(cached)) : DEFAULT_BUSY_TIMES;
    } catch {
      return DEFAULT_BUSY_TIMES;
    }
  });
  useEffect(() => {
    let active = true;
    Promise.resolve(
      getSupabase().from('app_config').select('value').eq('key', BUSY_TIMES_KEY).maybeSingle(),
    ).then(
      ({ data, error }) => {
        if (!active || error || !data) return;
        try {
          globalThis.localStorage?.setItem(BUSY_TIMES_KEY, JSON.stringify(data.value));
        } catch {
          // Not cached: the defaults apply offline.
        }
        setConfig(parseBusyTimes(data.value));
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  return config;
}

/** The member's own live busy blocks in the local copy. */
export function useMyBlocks(userId: string | null) {
  const { rows, loading } = useSyncedRows<BusyBlockRow>(BUSY_BLOCKS.name);
  const mine = useMemo(
    () => rows.filter((row) => row.user_id === userId && !row.deleted_at),
    [rows, userId],
  );
  return { mine, loading };
}

/**
 * Refreshes the member's busy blocks (C-05.3, FR2-DEV-5) when the app opens or returns to the
 * foreground, at most every refresh interval, once the local copy has loaded. Renders nothing.
 */
export function BusyTimesSync({
  householdId,
  userId,
  calendarIds,
}: {
  householdId: string;
  userId: string;
  calendarIds: readonly string[];
}) {
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const writer = useSyncWriter();
  const config = useBusyTimesConfig();
  const { mine, loading } = useMyBlocks(userId);
  const [opened, setOpened] = useState(() => Date.now());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setOpened(Date.now());
    });
    return () => subscription.remove();
  }, []);

  const ready =
    engine !== null &&
    !loading &&
    !status.firstLoad &&
    (status.state === 'idle' || status.state === 'offline');
  const calendars = calendarIds.join(',');

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!ready) return;
    queue.current = queue.current
      .then(async () => {
        // Taken away in the system's Settings: paused until it's given back.
        if ((await readCalendarAccess()) !== 'granted') return;
        await refreshBusyTimes({
          householdId,
          userId,
          calendarIds: calendars ? calendars.split(',') : [],
          mine,
          writer,
          config,
          now: Date.now(),
        });
      })
      .catch(reportError);
  }, [ready, householdId, userId, calendars, mine, writer, config, opened]);

  return null;
}
