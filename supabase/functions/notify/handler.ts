// The `notify` Edge Function (N-01.3, architecture "Notifications"): sends the pushes that are
// due. pg_cron calls it every minute through pg_net when any are waiting, with a shared
// secret. Preferences and quiet hours were applied when each notification was queued and
// again when it's claimed, so everything claimed here may go.
//
// Logs carry counts and fixed codes only: never tokens, user IDs or notification text.

import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { EXPO_BATCH_SIZE, type ExpoTicket } from './expo.ts';
import { buildMessages, type ClaimedPush, type ExpoMessage } from './messages.ts';

export interface NotifyDeps {
  /** The `NOTIFY_CRON_SECRET` secret; the function refuses to run without one. */
  secret: string | undefined;
  claim(batch: number): Promise<ClaimedPush[]>;
  release(ids: string[]): Promise<void>;
  dropTokens(tokens: string[]): Promise<void>;
  send(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  /** Claims per call, so one run can't go on for ever. */
  maxBatches?: number;
  log?: (event: string, fields: Record<string, number>) => void;
}

export interface NotifyResult {
  notifications: number;
  sent: number;
  failed: number;
  dropped: number;
}

const CLAIM_SIZE = 100;

/** Compares secrets in constant time. */
function sameSecret(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function createHandler(deps: NotifyDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((event, fields) => console.log(JSON.stringify({ event, ...fields })));
  const maxBatches = deps.maxBatches ?? 5;

  return async (req) => {
    if (req.method !== 'POST') return errorResponse('notify.method_not_allowed', 405);
    if (!deps.secret) return errorResponse('notify.not_configured', 503);
    const header = req.headers.get('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !sameSecret(token, deps.secret)) {
      return errorResponse('notify.unauthorized', 401);
    }

    const result: NotifyResult = { notifications: 0, sent: 0, failed: 0, dropped: 0 };
    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        const rows = await deps.claim(CLAIM_SIZE);
        if (rows.length === 0) break;
        result.notifications += rows.length;
        await sendRows(rows, deps, result);
        if (rows.length < CLAIM_SIZE) break;
      }
    } catch {
      log('notify.failed', result as unknown as Record<string, number>);
      return errorResponse('notify.failed', 500);
    }
    log('notify.done', result as unknown as Record<string, number>);
    return jsonResponse(result);
  };
}

async function sendRows(rows: ClaimedPush[], deps: NotifyDeps, result: NotifyResult) {
  const messages = buildMessages(rows);
  const dead: string[] = [];
  for (let start = 0; start < messages.length; start += EXPO_BATCH_SIZE) {
    const chunk = messages.slice(start, start + EXPO_BATCH_SIZE);
    let tickets: ExpoTicket[];
    try {
      tickets = await deps.send(chunk);
    } catch {
      // Expo didn't take the batch: hand its notifications back for the next run. A
      // notification split across batches may reach some devices twice; that's rarer and
      // kinder than never.
      result.failed += chunk.length;
      await deps.release([...new Set(chunk.map((m) => m.data.notificationId))]);
      continue;
    }
    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        result.sent += 1;
        return;
      }
      result.failed += 1;
      if (ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[index].to);
    });
  }
  if (dead.length > 0) {
    await deps.dropTokens(dead);
    result.dropped += dead.length;
  }
}
