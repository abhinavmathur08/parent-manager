/**
 * A minimal ZIP writer (APPNOTE 6.3, "stored", no compression) for data export (A-04.2,
 * FR-PRIV-2). Exports are small text files, so compression isn't worth a dependency; every
 * unzip tool and both platforms' file apps open stored entries. Names are UTF-8 (flag bit 11).
 */

export type ZipEntry = { name: string; data: Uint8Array };

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3), as ZIP requires for each entry. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date fields for a moment, in local time as ZIP tools expect. */
function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const UTF8_FLAG = 0x0800;

/** Builds a ZIP archive holding the entries, in order. */
export function createZip(entries: readonly ZipEntry[], modified: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosTime(modified);
  const files = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
  }));
  const localSize = files.reduce((sum, f) => sum + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((sum, f) => sum + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (value: number) => {
    view.setUint16(at, value, true);
    at += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(at, value >>> 0, true);
    at += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, at);
    at += value.length;
  };

  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(at);
    u32(0x04034b50);
    u16(20);
    u16(UTF8_FLAG);
    u16(0);
    u16(stamp.time);
    u16(stamp.date);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0);
    bytes(f.name);
    bytes(f.data);
  }
  const centralStart = at;
  files.forEach((f, i) => {
    u32(0x02014b50);
    u16(20);
    u16(20);
    u16(UTF8_FLAG);
    u16(0);
    u16(stamp.time);
    u16(stamp.date);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(offsets[i]);
    bytes(f.name);
  });
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(files.length);
  u16(files.length);
  u32(centralSize);
  u32(centralStart);
  u16(0);
  return out;
}
