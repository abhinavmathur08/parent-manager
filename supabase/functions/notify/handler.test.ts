import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

import { EXPO_PUSH_URL, ExpoSendError, type ExpoTicket, sendToExpo } from './expo.ts';
import { createHandler, type NotifyDeps } from './handler.ts';
import { buildMessages, type ClaimedPush, type ExpoMessage, textFor } from './messages.ts';

const SECRET = 'test-secret';

const push = (over: Partial<ClaimedPush> = {}): ClaimedPush => ({
  id: 'n1',
  user_id: 'u1',
  type: 'list_ready',
  payload: { week_start: '2026-11-15' },
  locale: 'en-US',
  tokens: ['ExponentPushToken[a]'],
  ...over,
});

function fakeDeps(batches: ClaimedPush[][], tickets?: (m: ExpoMessage[]) => ExpoTicket[]) {
  const calls = {
    sent: [] as ExpoMessage[][],
    released: [] as string[][],
    dropped: [] as string[][],
    logs: [] as string[],
  };
  const deps: NotifyDeps = {
    secret: SECRET,
    claim: () => Promise.resolve(batches.shift() ?? []),
    release: (ids) => {
      calls.released.push(ids);
      return Promise.resolve();
    },
    dropTokens: (tokens) => {
      calls.dropped.push(tokens);
      return Promise.resolve();
    },
    send: (messages) => {
      calls.sent.push(messages);
      return Promise.resolve(
        tickets ? tickets(messages) : messages.map((_, i) => ({ status: 'ok', id: `t${i}` })),
      );
    },
    log: (event, fields) => calls.logs.push(JSON.stringify({ event, ...fields })),
  };
  return { deps, calls };
}

const post = (secret: string | null = SECRET) =>
  new Request('http://localhost/notify', {
    method: 'POST',
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });

Deno.test('refuses callers without the cron secret', async () => {
  const { deps, calls } = fakeDeps([[push()]]);
  const handler = createHandler(deps);
  assertEquals((await handler(post(null))).status, 401);
  assertEquals((await handler(post('wrong'))).status, 401);
  assertEquals((await handler(new Request('http://localhost/notify'))).status, 405);
  assertEquals(calls.sent.length, 0);
});

Deno.test('does nothing until the secret is configured', async () => {
  const { deps } = fakeDeps([[push()]]);
  const response = await createHandler({ ...deps, secret: undefined })(post());
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, 'notify.not_configured');
});

Deno.test(
  'sends one silent message per device, in the recipient locale (FR-NOT-6, FR-NOT-9)',
  async () => {
    const { deps, calls } = fakeDeps([
      [
        push({ tokens: ['ExponentPushToken[a]', 'ExponentPushToken[b]'] }),
        push({
          id: 'n2',
          user_id: 'u2',
          type: 'plan_week',
          locale: 'en-GB',
          tokens: ['ExponentPushToken[c]'],
        }),
        push({ id: 'n3', user_id: 'u3', tokens: [] }),
      ],
    ]);
    const response = await createHandler(deps)(post());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { notifications: 3, sent: 3, failed: 0, dropped: 0 });
    const [messages] = calls.sent;
    assertEquals(
      messages.map((m) => m.to),
      ['ExponentPushToken[a]', 'ExponentPushToken[b]', 'ExponentPushToken[c]'],
    );
    assertEquals(messages[0], {
      to: 'ExponentPushToken[a]',
      title: textFor('list_ready', 'en-US').title,
      body: textFor('list_ready', 'en-US').body,
      data: { notificationId: 'n1', type: 'list_ready' },
      sound: null,
      channelId: 'default',
      categoryId: 'list_ready',
      priority: 'default',
    });
    assertEquals(messages[2].title, textFor('plan_week', 'en-GB').title);
  },
);

Deno.test('messages carry the notification ID and type only, never the payload', () => {
  const [message] = buildMessages([push({ payload: { week_start: '2026-11-15', secret: 'x' } })]);
  assertEquals(Object.keys(message.data).sort(), ['notificationId', 'type']);
  assertEquals(JSON.stringify(message).includes('2026-11-15'), false);
});

Deno.test('calendar pushes add the event ID and date, never the kind or change', () => {
  const event = 'eeeeeeee-0000-0000-0000-000000000001';
  for (const type of ['event_changed'] as const) {
    const [message] = buildMessages([
      push({
        type,
        payload: { event_id: event, change: 'moved', kind: 'kind.appointment', date: '2026-11-25' },
      }),
    ]);
    assertEquals(message.data, { notificationId: 'n1', type, event_id: event, date: '2026-11-25' });
    assertEquals(message.categoryId, type);
    assertEquals(JSON.stringify(message).includes('kind.'), false);
    assertEquals(JSON.stringify(message.data).includes('moved'), false);
  }
  const [odd] = buildMessages([
    push({ type: 'event_changed', payload: { event_id: 'Pediatrician', date: 'Tuesday' } }),
  ]);
  assertEquals(Object.keys(odd.data).sort(), ['notificationId', 'type']);
});

Deno.test(
  'falls back to en-US copy for an unknown locale, and the test push has no category',
  () => {
    const [message] = buildMessages([push({ type: 'test', locale: 'fr-FR' })]);
    assertEquals(message.title, textFor('test', 'en-US').title);
    assertEquals('categoryId' in message, false);
  },
);

Deno.test('has copy for every type in every locale', () => {
  for (const locale of ['en-US', 'en-GB', 'en-AU']) {
    for (const type of ['plan_week', 'list_ready', 'test', 'event_changed'] as const) {
      const text = textFor(type, locale);
      assertEquals(text.title.length > 0 && text.body.length > 0, true);
    }
  }
});

Deno.test('hands a batch Expo refused back for the next run', async () => {
  const { deps, calls } = fakeDeps([[push(), push({ id: 'n2' })]]);
  deps.send = () => Promise.reject(new ExpoSendError(503));
  const response = await createHandler(deps)(post());
  assertEquals(await response.json(), { notifications: 2, sent: 0, failed: 2, dropped: 0 });
  assertEquals(calls.released, [['n1', 'n2']]);
});

Deno.test('drops devices Expo says are gone, and keeps the rest', async () => {
  const { deps, calls } = fakeDeps(
    [[push({ tokens: ['ExponentPushToken[a]', 'ExponentPushToken[gone]'] })]],
    (messages) =>
      messages.map((m) =>
        m.to.includes('gone')
          ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: 't' },
      ),
  );
  const response = await createHandler(deps)(post());
  assertEquals(await response.json(), { notifications: 1, sent: 1, failed: 1, dropped: 1 });
  assertEquals(calls.dropped, [['ExponentPushToken[gone]']]);
  assertEquals(calls.released, []);
});

Deno.test('keeps claiming full batches, up to a limit', async () => {
  const full = Array.from({ length: 100 }, (_, i) => push({ id: `n${i}` }));
  const { deps, calls } = fakeDeps([full, full, full]);
  const response = await createHandler({ ...deps, maxBatches: 2 })(post());
  assertEquals((await response.json()).notifications, 200);
  assertEquals(calls.sent.length, 2);
});

Deno.test('logs counts only', async () => {
  const { deps, calls } = fakeDeps([[push()]]);
  await createHandler(deps)(post());
  assertEquals(calls.logs, [
    '{"event":"notify.done","notifications":1,"sent":1,"failed":0,"dropped":0}',
  ]);
});

Deno.test('a database failure is a 500 and sends nothing more', async () => {
  const { deps } = fakeDeps([]);
  deps.claim = () => Promise.reject(new Error('down'));
  assertEquals((await createHandler(deps)(post())).status, 500);
});

Deno.test('posts to Expo in one request and returns its tickets', async () => {
  const requests: Request[] = [];
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 'x' }] }), { status: 200 }),
    );
  }) as typeof fetch;
  const tickets = await sendToExpo(buildMessages([push()]), fetchFn, 'expo-token');
  assertEquals(tickets, [{ status: 'ok', id: 'x' }]);
  assertEquals(requests[0].url, EXPO_PUSH_URL);
  assertEquals(requests[0].headers.get('Authorization'), 'Bearer expo-token');
  assertEquals((await requests[0].json())[0].to, 'ExponentPushToken[a]');
});

Deno.test('an Expo error status is an ExpoSendError', async () => {
  const fetchFn = (() => Promise.resolve(new Response('busy', { status: 429 }))) as typeof fetch;
  await assertRejects(() => sendToExpo(buildMessages([push()]), fetchFn), ExpoSendError);
  const short = (() =>
    Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))) as typeof fetch;
  await assertRejects(() => sendToExpo(buildMessages([push()]), short), ExpoSendError);
});
