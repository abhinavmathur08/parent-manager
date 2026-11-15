import Storage from 'expo-sqlite/kv-store';

import { getSupabase } from '@/lib/supabase';

/** The four Phase 1 types (FR-NOT-1). */
export const NOTIFICATION_TYPES = [
  'plan_week',
  'list_ready',
  'defrost',
  'household_changes',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Types that reach the device outside the app, so they need the system permission: two
 * pushes and the local "defrost tonight". Household changes are inbox only (FR-NOT-1).
 */
export const DEVICE_TYPES: readonly NotificationType[] = ['plan_week', 'list_ready', 'defrost'];

/**
 * A member's settings (FR-NOT-3, FR-NOT-6, FR-NOT-7). Times are minutes after midnight in the
 * household's timezone. `planWeekDay` is an ISO weekday, or null for the day before the
 * household's week starts.
 */
export type NotificationPrefs = Record<NotificationType, boolean> & {
  planWeekDay: number | null;
  planWeekMinute: number;
  quietStartMinute: number;
  quietEndMinute: number;
};

/** What the server assumes for a member who never changed anything. */
export const DEFAULT_PREFS: NotificationPrefs = {
  plan_week: true,
  list_ready: true,
  defrost: true,
  household_changes: true,
  planWeekDay: null,
  planWeekMinute: 18 * 60,
  quietStartMinute: 21 * 60,
  quietEndMinute: 7 * 60,
};

type Row = {
  plan_week: boolean;
  list_ready: boolean;
  defrost: boolean;
  household_changes: boolean;
  plan_week_day: number | null;
  plan_week_minute: number;
  quiet_start_minute: number;
  quiet_end_minute: number;
};

const COLUMNS =
  'plan_week, list_ready, defrost, household_changes, plan_week_day, plan_week_minute, quiet_start_minute, quiet_end_minute';

const fromRow = (row: Row): NotificationPrefs => ({
  plan_week: row.plan_week,
  list_ready: row.list_ready,
  defrost: row.defrost,
  household_changes: row.household_changes,
  planWeekDay: row.plan_week_day,
  planWeekMinute: row.plan_week_minute,
  quietStartMinute: row.quiet_start_minute,
  quietEndMinute: row.quiet_end_minute,
});

const toRow = (prefs: NotificationPrefs): Row => ({
  plan_week: prefs.plan_week,
  list_ready: prefs.list_ready,
  defrost: prefs.defrost,
  household_changes: prefs.household_changes,
  plan_week_day: prefs.planWeekDay,
  plan_week_minute: prefs.planWeekMinute,
  quiet_start_minute: prefs.quietStartMinute,
  quiet_end_minute: prefs.quietEndMinute,
});

const cacheKey = (userId: string) => `notifications.prefs.${userId}`;

/**
 * The last settings seen on this device, for what runs offline (local "defrost tonight"
 * notifications, N-02.2). Defaults when nothing was saved.
 */
export function cachedPrefs(userId: string): NotificationPrefs {
  try {
    const raw = Storage.getItemSync(cacheKey(userId));
    return raw
      ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) }
      : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function cache(userId: string, prefs: NotificationPrefs): void {
  try {
    Storage.setItemSync(cacheKey(userId), JSON.stringify(prefs));
  } catch {
    // The cache only helps offline; the server has the settings.
  }
}

export async function fetchPrefs(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await getSupabase()
    .from('notification_prefs')
    .select(COLUMNS)
    .eq('user_id', userId)
    .maybeSingle<Row>();
  if (error) throw error;
  const prefs = data ? fromRow(data) : DEFAULT_PREFS;
  cache(userId, prefs);
  return prefs;
}

/** Saves all settings at once, so the server always holds a whole, consistent row. */
export async function savePrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
  const { error } = await getSupabase()
    .from('notification_prefs')
    .upsert({ user_id: userId, ...toRow(prefs) }, { onConflict: 'user_id' });
  if (error) throw error;
  cache(userId, prefs);
}

/** ISO weekday (1 Monday to 7 Sunday) of the day before a week that starts on `weekStart`. */
export function dayBefore(weekStart: number): number {
  return weekStart === 1 ? 7 : weekStart - 1;
}
