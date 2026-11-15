// Turns claimed notifications into Expo push messages, one per device, with copy in the
// recipient's locale (FR-NOT-9). Messages carry the notification's ID and type only, so a tap
// can open the right screen; never names, list or recipe text, or children's details.

import copy from './copy.json' with { type: 'json' };

export type PushType = 'plan_week' | 'list_ready' | 'test';

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
  data: { notificationId: string; type: PushType };
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
export function buildMessages(rows: readonly ClaimedPush[]): ExpoMessage[] {
  return rows.flatMap((row) => {
    const { title, body } = textFor(row.type, row.locale);
    return row.tokens.map((to) => ({
      to,
      title,
      body,
      data: { notificationId: row.id, type: row.type },
      sound: null,
      channelId: 'default' as const,
      ...(row.type === 'test' ? {} : { categoryId: row.type }),
      priority: 'default' as const,
    }));
  });
}
