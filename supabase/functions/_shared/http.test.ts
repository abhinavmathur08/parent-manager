import { assertEquals, assertThrows } from 'jsr:@std/assert@1';

import { errorResponse, jsonResponse } from './http.ts';

Deno.test('jsonResponse serializes the body with a JSON content type', async () => {
  const response = jsonResponse({ ok: true }, 201);
  assertEquals(response.status, 201);
  assertEquals(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assertEquals(await response.json(), { ok: true });
});

Deno.test('errorResponse returns a stable code and no message text', async () => {
  const response = errorResponse('import.quota_exceeded', 429);
  assertEquals(response.status, 429);
  assertEquals(await response.json(), { error: { code: 'import.quota_exceeded' } });
});

Deno.test('errorResponse rejects free text in place of a code', () => {
  assertThrows(() => errorResponse('You have run out of imports', 429));
});

Deno.test('errorResponse rejects a success status', () => {
  assertThrows(() => errorResponse('import.failed', 200));
});
