import { crc32, createZip } from '@/lib/zip';

const encode = (text: string) => new TextEncoder().encode(text);
const u32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
const u16 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint16(at, true);

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(encode(''))).toBe(0);
  });
});

describe('createZip (A-04.2)', () => {
  const zip = createZip(
    [
      { name: 'manifest.json', data: encode('{"a":1}') },
      { name: 'recettes-é.csv', data: encode('title\r\nCrêpes\r\n') },
    ],
    new Date(2026, 10, 18, 12, 30, 10),
  );

  it('writes a local header, then the stored data, for each entry', () => {
    expect(u32(zip, 0)).toBe(0x04034b50);
    expect(u16(zip, 8)).toBe(0); // stored
    expect(u16(zip, 6) & 0x0800).toBe(0x0800); // UTF-8 names
    expect(u32(zip, 14)).toBe(crc32(encode('{"a":1}')));
    const nameLength = u16(zip, 26);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLength))).toBe('manifest.json');
    expect(new TextDecoder().decode(zip.slice(30 + nameLength, 30 + nameLength + 7))).toBe(
      '{"a":1}',
    );
  });

  it('ends with a directory that finds every entry', () => {
    const end = zip.length - 22;
    expect(u32(zip, end)).toBe(0x06054b50);
    expect(u16(zip, end + 10)).toBe(2);
    const centralSize = u32(zip, end + 12);
    const centralStart = u32(zip, end + 16);
    expect(centralStart + centralSize).toBe(end);
    expect(u32(zip, centralStart)).toBe(0x02014b50);
    // The second entry's local header is where the directory says.
    const second = centralStart + 46 + u16(zip, centralStart + 28);
    expect(u32(zip, u32(zip, second + 42))).toBe(0x04034b50);
  });

  it('stores the time in MS-DOS format', () => {
    expect(u16(zip, 12)).toBe(((2026 - 1980) << 9) | (11 << 5) | 18);
    expect(u16(zip, 10)).toBe((12 << 11) | (30 << 5) | 5);
  });
});
