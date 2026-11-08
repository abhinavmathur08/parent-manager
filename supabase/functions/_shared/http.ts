// Shared HTTP helpers for Edge Functions.
//
// Errors carry a stable code (such as `import.quota_exceeded`) that the app translates.
// Functions never return user-facing text, so responses stay language-neutral.

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function errorResponse(code: string, status: number): Response {
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(code)) {
    throw new Error(`Error codes look like "area.reason"; got "${code}"`);
  }
  if (status < 400 || status > 599) {
    throw new Error(`Error responses need a 4xx or 5xx status; got ${status}`);
  }
  return jsonResponse({ error: { code } }, status);
}
