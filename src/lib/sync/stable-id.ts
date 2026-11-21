/**
 * A row ID worked out from what the row is about, the same on every device, so two devices
 * that create "the same" row offline write one row instead of two (architecture section 5).
 * For example an exception to one occurrence of a repeating event is
 * `stableId('event_exception', eventId, originalDate)` (R2-CAL-2).
 *
 * The parts are hashed to 128 bits (four 32-bit lanes of a MurmurHash3-style mix) and stamped
 * as a version 8 UUID (RFC 9562). This is not a security hash: the IDs are only unique
 * names, and every write is still checked by RLS.
 */
export function stableId(...parts: string[]): string {
  if (parts.length < 2 || parts.some((part) => typeof part !== 'string' || part === '')) {
    throw new Error('stableId needs a kind and at least one non-empty part');
  }
  // A separator that can't appear in IDs or dates, so ("ab", "c") and ("a", "bc") differ.
  const text = parts.join('\u0000');
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;

  const bytes: number[] = [];
  for (const lane of [h1, h2, h3, h4]) {
    bytes.push((lane >>> 24) & 0xff, (lane >>> 16) & 0xff, (lane >>> 8) & 0xff, lane & 0xff);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
