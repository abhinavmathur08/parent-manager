import Storage from 'expo-sqlite/kv-store';

import { getSupabase } from '@/lib/supabase';

/**
 * The four Phase 1 types (FR-NOT-1), then Phase 2's calendar types (FR2-REM-2, 4 and 5) and
 * document expiry reminders (FR2-DOC-7), then Phase 3's local task reminders, the "assigned to you"
 * push and local today's tasks (FR3-NOT-5).
 */
export const NOTIFICATION_TYPES = [
  'plan_week',
  'list_ready',
  'defrost',
  'household_changes',
  'calendar_reminders',
  'event_changes',
  'who_taking',
  'document_expiry',
  'task_reminders',
  'task_assigned',
  'tasks_today',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Types that reach the device outside the app, so they need the system permission: two
 * pushes and the local "defrost tonight" and event reminders. Household changes are inbox
 * only (FR-NOT-1).
 */
export const DEVICE_TYPES: readonly NotificationType[] = [
  'plan_week',
  'list_ready',
  'defrost',
  'calendar_reminders',
  'event_changes',
  'who_taking',
  'document_expiry',
  'task_reminders',
  'task_assigned',
  'tasks_today',
];

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
  calendar_reminders: true,
  event_changes: true,
  who_taking: true,
  document_expiry: true,
  task_reminders: true,
  task_assigned: true,
  tasks_today: true,
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
  calendar_reminders: boolean;
  event_changes: boolean;
  who_taking: boolean;
  document_expiry: boolean;
  task_reminders: boolean;
  task_assigned: boolean;
  tasks_today: boolean;
  plan_week_day: number | null;
  plan_week_minute: number;
  quiet_start_minute: number;
  quiet_end_minute: number;
};

const COLUMNS =
  'plan_week, list_ready, defrost, household_changes, calendar_reminders, event_changes, who_taking, document_expiry, task_reminders, task_assigned, tasks_today, plan_week_day, plan_week_minute, quiet_start_minute, quiet_end_minute';

const fromRow = (row: Row): NotificationPrefs => ({
  plan_week: row.plan_week,
  list_ready: row.list_ready,
  defrost: row.defrost,
  household_changes: row.household_changes,
  calendar_reminders: row.calendar_reminders,
  event_changes: row.event_changes,
  who_taking: row.who_taking,
  document_expiry: row.document_expiry,
  task_reminders: row.task_reminders,
  task_assigned: row.task_assigned,
  tasks_today: row.tasks_today,
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
  calendar_reminders: prefs.calendar_reminders,
  event_changes: prefs.event_changes,
  who_taking: prefs.who_taking,
  document_expiry: prefs.document_expiry,
  task_reminders: prefs.task_reminders,
  task_assigned: prefs.task_assigned,
  tasks_today: prefs.tasks_today,
  plan_week_day: prefs.planWeekDay,
  plan_week_minute: prefs.planWeekMinute,
  quiet_start_minute: prefs.quietStartMinute,
  quiet_end_minute: prefs.quietEndMinute,
});

const cacheKey = (userId: string) => `notifications.prefs.${userId}`;

const listeners = new Set<() => void>();

/** Runs `listener` whenever settings are saved or fetched, such as "defrost tonight" turned off. */
export function onPrefsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The last settings seen on this device, for what runs offline (local "defrost tonight"
 * notifications, N-02.2, and event reminders, C-04.1). Defaults when nothing was saved.
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
  listeners.forEach((listener) => listener());
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
