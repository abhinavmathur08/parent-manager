// Turns claimed notifications into Expo push messages, one per device, with copy in the
// recipient's locale (FR-NOT-9). Messages carry the notification's ID and type, plus the event
// ID and occurrence date for calendar types (FR2-REM-4), so a tap can open the right screen;
// never names, titles, list or recipe text, or children's details.

import copy from './copy.json' with { type: 'json' };

export type PushType = 'plan_week' | 'list_ready' | 'test' | 'event_changed' | 'who_taking';

/** Types whose tap opens one event occurrence: their message names it by ID and date. */
const EVENT_TYPES: readonly PushType[] = ['event_changed', 'who_taking'];

/** A row from claim_pushes(). */
export interface ClaimedPush {
  id: string;
  user_id: string;
  type: PushType;
  payload: Record<string, unknown>;
  locale: string | null;
  tokens: string[];
}

/** An Expo push message (https://docs.expo.dev/push-notifications/sending-notifications/). */
export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { notificationId: string; type: PushType; event_id?: string; date?: string };
  /** No sound, ever (FR-NOT-6, NFR-A11Y-7). */
  sound: null;
  channelId: 'default';
  /** The category that offers "turn off this type" (FR-NOT-7); the test push has none. */
  categoryId?: string;
  priority: 'default';
}

type Copy = Record<string, Record<PushType, { title: string; body: string }>>;
const COPY = copy as Copy;
export const DEFAULT_LOCALE = 'en-US';

export function textFor(type: PushType, locale: string | null): { title: string; body: string } {
  return (COPY[locale ?? DEFAULT_LOCALE] ?? COPY[DEFAULT_LOCALE])[type];
}

/** A message per device. A member with no devices gets the inbox entry only. */
/** The event ID and date of a calendar push, when they look like an ID and a date. */
function eventData(row: ClaimedPush): { event_id?: string; date?: string } {
  if (!EVENT_TYPES.includes(row.type)) return {};
  const { event_id: id, date } = row.payload;
  return {
    ...(typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? { event_id: id } : {}),
    ...(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
  };
}

export function buildMessages(rows: readonly ClaimedPush[]): ExpoMessage[] {
  return rows.flatMap((row) => {
    const { title, body } = textFor(row.type, row.locale);
    const data = { notificationId: row.id, type: row.type, ...eventData(row) };
    return row.tokens.map((to) => ({
      to,
      title,
      body,
      data,
      sound: null,
      channelId: 'default' as const,
      ...(row.type === 'test' ? {} : { categoryId: row.type }),
      priority: 'default' as const,
    }));
  });
}
