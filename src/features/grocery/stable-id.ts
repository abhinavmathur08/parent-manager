/**
 * A UUID worked out from text, the same on every device (RFC 9562 version 8). The list
 * engine names the rows it creates this way, so two devices recalculating the same list
 * offline write the same rows instead of duplicates (NFR-OFF-5, R-LIST-7).
 *
 * It is a non-cryptographic 128-bit hash (four seeded 32-bit FNV-1a/Murmur-style lanes):
 * collisions are vanishingly unlikely for the few hundred rows of a list, and the inputs
 * are the household's own IDs, so nothing needs to be kept secret.
 */
export function stableId(...parts: readonly string[]): string {
  const text = parts.join('\u0001');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h3 = Math.imul(h3 ^ c, 0xcc9e2d51);
    h4 = Math.imul(h4 ^ c, 0x1b873593);
  }
  const mix = (h: number, other: number) => {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ other;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const words = [mix(h1, h4), mix(h2, h1), mix(h3, h2), mix(h4, h3)];
  const bytes = words.flatMap((w) => [w >>> 24, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff]);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
