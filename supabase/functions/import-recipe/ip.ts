// Which IP addresses a link import may fetch from: public unicast only (architecture
// section 6, SSRF guards). Everything private, loopback, link-local, reserved or special
// purpose is refused, including IPv6 forms that embed an IPv4 address.

/** Parses dotted-quad IPv4, or returns null. */
export function parseIPv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^(0|[1-9]\d{0,2})$/.test(part) ? Number(part) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

/** Parses IPv6 (with an optional embedded IPv4 tail) into 8 16-bit groups, or returns null. */
export function parseIPv6(text: string): number[] | null {
  let input = text.toLowerCase();
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  if (input.includes('%')) return null; // zone IDs are link-local by definition

  // Rewrite an embedded IPv4 tail (::ffff:1.2.3.4) as two hex groups.
  const lastColon = input.lastIndexOf(':');
  const last = input.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (!v4) return null;
    const hex = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
    input = `${input.slice(0, lastColon + 1)}${hex(v4[0], v4[1])}:${hex(v4[2], v4[3])}`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (![...head, ...rest].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;

  const known = head.length + rest.length;
  if (halves.length === 1 ? known !== 8 : known >= 8) return null;
  const zeros = new Array<string>(8 - known).fill('0');
  return [...head, ...zeros, ...rest].map((g) => parseInt(g, 16));
}

// [first address, prefix length] for IPv4 ranges that are never fetched.
const BLOCKED_V4: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, including cloud metadata
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved and broadcast
];

function v4ToInt(bytes: number[]): number {
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}

function isPublicIPv4(bytes: number[]): boolean {
  const address = v4ToInt(bytes);
  return BLOCKED_V4.every(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (address & mask) >>> 0 !== (v4ToInt(base) & mask) >>> 0;
  });
}

function isPublicIPv6(groups: number[]): boolean {
  const embeddedV4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judge the IPv4 address.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return isPublicIPv4(embeddedV4(groups[6], groups[7]));
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return isPublicIPv4(embeddedV4(groups[6], groups[7]));
  }
  // 6to4 (2002::/16) embeds an IPv4 address in groups 1 and 2.
  if (groups[0] === 0x2002) return isPublicIPv4(embeddedV4(groups[1], groups[2]));
  // Only global unicast (2000::/3) is public.
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  if (groups[0] === 0x2001 && groups[1] < 0x0200) return false; // Teredo and IETF special use
  return true;
}

/** True only for a public unicast IPv4 or IPv6 address. Anything unparseable is false. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(address);
  return v6 ? isPublicIPv6(v6) : false;
}
