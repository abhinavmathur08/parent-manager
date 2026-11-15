// Sends messages through the Expo push service. Expo takes at most 100 messages a request
// and answers with one ticket per message, in order.

import type { ExpoMessage } from './messages.ts';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_BATCH_SIZE = 100;

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export class ExpoSendError extends Error {
  constructor(readonly status: number) {
    super(`Expo push request failed with ${status}`);
  }
}

/**
 * Posts one batch. `accessToken` is needed only if the Expo project turns on enhanced push
 * security; it comes from the `EXPO_ACCESS_TOKEN` Edge Function secret.
 */
export async function sendToExpo(
  messages: readonly ExpoMessage[],
  fetchFn: typeof fetch,
  accessToken?: string,
): Promise<ExpoTicket[]> {
  if (messages.length > EXPO_BATCH_SIZE) throw new Error('At most 100 messages a request');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetchFn(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });
  if (!response.ok) throw new ExpoSendError(response.status);
  const body = (await response.json()) as { data?: ExpoTicket[] };
  if (!Array.isArray(body.data) || body.data.length !== messages.length) {
    throw new ExpoSendError(response.status);
  }
  return body.data;
}
