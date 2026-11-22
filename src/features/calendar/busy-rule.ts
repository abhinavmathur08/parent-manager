import 'expo-sqlite/localStorage/install';

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getSupabase } from '@/lib/supabase';

import { BUSY_RULE_KEY, DEFAULT_BUSY_RULE, parseBusyRule, type BusyRule } from './busy';

// The rule seen last, so busy days work offline with the household's thresholds (R2-PAY-1).
const CACHE_KEY = 'calendar.busy_rule';

function readCached(): BusyRule {
  try {
    const stored = globalThis.localStorage?.getItem(CACHE_KEY);
    return stored ? parseBusyRule(JSON.parse(stored)) : DEFAULT_BUSY_RULE;
  } catch {
    return DEFAULT_BUSY_RULE;
  }
}

/** Reads `app_config` `calendar.busy_rule`, or throws when offline. */
export async function fetchBusyRule(): Promise<BusyRule> {
  const { data, error } = await getSupabase()
    .from('app_config')
    .select('value')
    .eq('key', BUSY_RULE_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseBusyRule(data?.value);
}

const same = (a: BusyRule, b: BusyRule) =>
  (Object.keys(a) as (keyof BusyRule)[]).every((key) => a[key] === b[key]);

/**
 * The busy-day thresholds (R2-BUSY-1): the cached rule at once, then the server's, fetched
 * again whenever the app returns to the foreground. Falls back to the defaults.
 */
export function useBusyRule(): BusyRule {
  const [rule, setRule] = useState(readCached);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetchBusyRule().then(
        (next) => {
          if (!active) return;
          try {
            globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(toConfig(next)));
          } catch {
            // Not cached: the next launch uses the defaults until the fetch returns.
          }
          setRule((current) => (same(current, next) ? current : next));
        },
        () => undefined,
      );
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return rule;
}

function toConfig(rule: BusyRule) {
  return {
    dinner_start: rule.dinnerStart,
    dinner_end: rule.dinnerEnd,
    day_start: rule.dayStart,
    day_end: rule.dayEnd,
    booked_minutes: rule.bookedMinutes,
  };
}
