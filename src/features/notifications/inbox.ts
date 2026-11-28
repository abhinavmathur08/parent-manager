import type { Href } from 'expo-router';

import { formatDate } from '@/i18n';
import { getSupabase } from '@/lib/supabase';

/** Types the server stores. "Defrost tonight" is local to the device and never in the inbox. */
export type InboxType =
  | 'plan_week'
  | 'list_ready'
  | 'household_changes'
  | 'test'
  | 'event_changed'
  | 'who_taking'
  | 'document_expiring';

export type InboxItem = {
  id: string;
  type: InboxType;
  /** IDs, dates and fixed values only, such as `{ event: 'member_joined' }`. */
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

/** FR-NOT-8 (PROPOSED): the inbox shows the last 50. */
export const INBOX_SIZE = 50;

const HOUSEHOLD_EVENTS = ['member_joined', 'member_left'] as const;
const EVENT_CHANGES = ['created', 'moved', 'cancelled'] as const;

/**
 * Document categories an expiry reminder may name. `doc.medical` never reaches a notification
 * (FR2-DOC-11), so the server leaves the category out and the entry says "a document".
 */
const EXPIRY_CATEGORIES = [
  'doc.insurance',
  'doc.identity',
  'doc.childcare_school',
  'doc.household',
  'doc.other',
] as const;

const expiryCategory = (payload: Record<string, unknown>): string | null =>
  (EXPIRY_CATEGORIES as readonly unknown[]).includes(payload.category)
    ? (payload.category as string).slice('doc.'.length)
    : null;

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Values for an item's text: an expiry reminder's category name and date (FR2-DOC-7). Every
 * other message is fixed text.
 */
export function messageValues(
  item: Pick<InboxItem, 'type' | 'payload'>,
  t: (key: string) => string,
  locale: string,
): Record<string, string> {
  if (item.type !== 'document_expiring') return {};
  const category = expiryCategory(item.payload);
  const date = item.payload.expires_on;
  return {
    ...(category ? { category: t(`notifications.documentCategory.${category}`) } : {}),
    ...(isDate(date)
      ? {
          date: formatDate(new Date(`${date}T00:00:00Z`), locale, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          }),
        }
      : {}),
  };
}

/** The key under `notifications.messages` for an item's title and body. */
export function messageKey(item: Pick<InboxItem, 'type' | 'payload'>): string {
  if (item.type === 'event_changed') {
    const change = item.payload.change;
    return (EVENT_CHANGES as readonly unknown[]).includes(change)
      ? `event_${change as string}`
      : 'event_changed';
  }
  if (item.type === 'document_expiring') {
    return expiryCategory(item.payload) ? 'document_expiring_category' : 'document_expiring_any';
  }
  if (item.type !== 'household_changes') return item.type;
  const event = item.payload.event;
  return (HOUSEHOLD_EVENTS as readonly unknown[]).includes(event)
    ? (event as string)
    : 'member_joined';
}

/**
 * Where tapping an item, in the inbox or as a push or local notification, goes (FR-NOT-8).
 * `data` holds IDs only, such as the event and occurrence date of a calendar notification.
 * `from` says where a "who's taking?" prompt was answered from, for its analytics.
 */
export function routeFor(
  type: string,
  data: Record<string, unknown> = {},
  from?: 'push' | 'inbox',
): Href | null {
  switch (type) {
    case 'calendar_reminders':
    case 'event_changed':
    case 'who_taking':
      return typeof data.event_id === 'string'
        ? {
            pathname: '/calendar/[id]',
            params: {
              id: data.event_id,
              ...(typeof data.date === 'string' ? { date: data.date } : {}),
              ...(type === 'who_taking' && from ? { prompt: from } : {}),
            },
          }
        : '/calendar';
    case 'plan_week':
    case 'defrost':
      // "Defrost tonight" is today's dinner, which the Plan tab scrolls into view.
      return '/plan';
    case 'list_ready':
      return '/list';
    case 'household_changes':
      return '/household/members';
    case 'document_expiring':
      // The vault opens from the Household tab.
      return '/household';
    case 'task_reminder':
      return typeof data.task_id === 'string'
        ? { pathname: '/tasks/[id]', params: { id: data.task_id } }
        : '/tasks';
    case 'tasks_today':
      return '/tasks';
    case 'test':
      return '/household/notifications';
    default:
      return null;
  }
}

type Row = {
  id: string;
  type: InboxType;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
};

export async function fetchInbox(): Promise<InboxItem[]> {
  const { data, error } = await getSupabase()
    .from('notifications')
    .select('id, type, payload, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(INBOX_SIZE)
    .returns<Row[]>();
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    payload: row.payload ?? {},
    createdAt: row.created_at,
    readAt: row.read_at,
  }));
}

export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await getSupabase()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return Math.min(count ?? 0, INBOX_SIZE);
}

/** Marks the given notifications read, or all of them; on every device (spec 3.11 edge cases). */
export async function markRead(ids?: readonly string[]): Promise<void> {
  const { error } = await getSupabase().rpc('mark_notifications_read', {
    ids: ids ? [...ids] : null,
  });
  if (error) throw error;
}

/** Sends the caller a test push, to check delivery on a device (N-01.3). */
export async function sendTestNotification(): Promise<void> {
  const { error } = await getSupabase().rpc('send_test_notification');
  if (error) throw error;
}
