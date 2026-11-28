import 'expo-sqlite/localStorage/install';

import { useEffect, useState } from 'react';

import { getSupabase } from '@/lib/supabase';

/** `app_config` `tasks.limits` (R3-PAY-1, D-24); these values when offline or unset. */
export const TASK_LIMITS_KEY = 'tasks.limits';

export type TaskLimits = {
  freeChores: number;
  upcomingDays: number;
  doneHistoryWeeks: number;
};

export const DEFAULT_TASK_LIMITS: TaskLimits = {
  freeChores: 3,
  upcomingDays: 14,
  doneHistoryWeeks: 4,
};

const whole = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;

export function parseTaskLimits(value: unknown): TaskLimits {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    freeChores: whole(v.free_chores, 0, 1000, DEFAULT_TASK_LIMITS.freeChores),
    upcomingDays: whole(v.upcoming_days, 1, 90, DEFAULT_TASK_LIMITS.upcomingDays),
    doneHistoryWeeks: whole(v.done_history_weeks, 0, 520, DEFAULT_TASK_LIMITS.doneHistoryWeeks),
  };
}

/** The tasks settings: cached on the device, then the server's, else the defaults. */
export function useTaskLimits(): TaskLimits {
  const [limits, setLimits] = useState<TaskLimits>(() => {
    try {
      const cached = globalThis.localStorage?.getItem(TASK_LIMITS_KEY);
      return cached ? parseTaskLimits(JSON.parse(cached)) : DEFAULT_TASK_LIMITS;
    } catch {
      return DEFAULT_TASK_LIMITS;
    }
  });
  useEffect(() => {
    let active = true;
    // Deferred, so a missing client config (tests, a misconfigured build) fails quietly too.
    Promise.resolve()
      .then(() =>
        getSupabase().from('app_config').select('value').eq('key', TASK_LIMITS_KEY).maybeSingle(),
      )
      .then(
        ({ data, error }) => {
          if (!active || error || !data) return;
          try {
            globalThis.localStorage?.setItem(TASK_LIMITS_KEY, JSON.stringify(data.value));
          } catch {
            // Not cached: the defaults apply offline.
          }
          setLimits(parseTaskLimits(data.value));
        },
        () => undefined,
      );
    return () => {
      active = false;
    };
  }, []);
  return limits;
}
