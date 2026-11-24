/**
 * A minimal ZIP writer (APPNOTE 6.3, "stored", no compression) for data export (A-04.2,
 * FR-PRIV-2). Exports are text files and already-compressed JPEGs and PDFs (A-05), so
 * compression isn't worth a dependency; every unzip tool and both platforms' file apps open
 * stored entries. Names are UTF-8 (flag bit 11). `ZipWriter` streams entries to a sink, so a
 * household's documents never have to fit in memory at once; `createZip` builds a small one.
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
/** ZIP without the ZIP64 extension: at most 65,535 entries and 4 GiB in all. */
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/** Where a `ZipWriter` sends its bytes, in order. */
export type ZipSink = (bytes: Uint8Array) => void | Promise<void>;

type Written = { name: Uint8Array; crc: number; size: number; offset: number };

/** A little-endian record of 16- and 32-bit fields and byte strings. */
function record(parts: (['u16' | 'u32', number] | Uint8Array)[]): Uint8Array {
  const length = parts.reduce(
    (sum, p) => sum + (p instanceof Uint8Array ? p.length : p[0] === 'u16' ? 2 : 4),
    0,
  );
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const part of parts) {
    if (part instanceof Uint8Array) {
      out.set(part, at);
      at += part.length;
    } else if (part[0] === 'u16') {
      view.setUint16(at, part[1], true);
      at += 2;
    } else {
      view.setUint32(at, part[1] >>> 0, true);
      at += 4;
    }
  }
  return out;
}

/** Lays out a ZIP archive: the bytes of each entry in turn, then the directory. */
class ZipLayout {
  private readonly encoder = new TextEncoder();
  private readonly stamp: { time: number; date: number };
  private readonly written: Written[] = [];
  /** Bytes laid out so far. */
  offset = 0;

  constructor(modified: Date) {
    this.stamp = dosTime(modified);
  }

  private take(parts: Uint8Array[]): Uint8Array[] {
    const length = parts.reduce((sum, p) => sum + p.length, 0);
    if (this.offset + length > MAX_BYTES) throw new Error('zip: archive too large');
    this.offset += length;
    return parts;
  }

  /** An entry's local header and data. */
  entry(name: string, data: Uint8Array): Uint8Array[] {
    if (this.written.length >= MAX_ENTRIES) throw new Error('zip: too many entries');
    const e: Written = {
      name: this.encoder.encode(name),
      crc: crc32(data),
      size: data.length,
      offset: this.offset,
    };
    const { time, date } = this.stamp;
    const parts = this.take([
      record([
        ['u32', 0x04034b50],
        ['u16', 20],
        ['u16', UTF8_FLAG],
        ['u16', 0],
        ['u16', time],
        ['u16', date],
        ['u32', e.crc],
        ['u32', e.size],
        ['u32', e.size],
        ['u16', e.name.length],
        ['u16', 0],
        e.name,
      ]),
      data,
    ]);
    this.written.push(e);
    return parts;
  }

  /** The central directory and the end record. */
  end(): Uint8Array[] {
    const { time, date } = this.stamp;
    const start = this.offset;
    const central = this.take(
      this.written.map((e) =>
        record([
          ['u32', 0x02014b50],
          ['u16', 20],
          ['u16', 20],
          ['u16', UTF8_FLAG],
          ['u16', 0],
          ['u16', time],
          ['u16', date],
          ['u32', e.crc],
          ['u32', e.size],
          ['u32', e.size],
          ['u16', e.name.length],
          ['u16', 0],
          ['u16', 0],
          ['u16', 0],
          ['u16', 0],
          ['u32', 0],
          ['u32', e.offset],
          e.name,
        ]),
      ),
    );
    const count = this.written.length;
    return [
      ...central,
      ...this.take([
        record([
          ['u32', 0x06054b50],
          ['u16', 0],
          ['u16', 0],
          ['u16', count],
          ['u16', count],
          ['u32', this.offset - start],
          ['u32', start],
          ['u16', 0],
        ]),
      ]),
    ];
  }
}

/** Writes a ZIP archive entry by entry to a sink, then its directory on `finish`. */
export class ZipWriter {
  private readonly layout: ZipLayout;

  constructor(
    private readonly sink: ZipSink,
    modified: Date = new Date(),
  ) {
    this.layout = new ZipLayout(modified);
  }

  /** Bytes written so far. */
  get size(): number {
    return this.layout.offset;
  }

  async add(name: string, data: Uint8Array): Promise<void> {
    for (const part of this.layout.entry(name, data)) await this.sink(part);
  }

  /** Writes the central directory and the end record. Add nothing after this. */
  async finish(): Promise<void> {
    for (const part of this.layout.end()) await this.sink(part);
  }
}

/** Builds a small ZIP archive in memory, holding the entries in order. */
export function createZip(entries: readonly ZipEntry[], modified: Date = new Date()): Uint8Array {
  const layout = new ZipLayout(modified);
  const parts = [...entries.flatMap((e) => layout.entry(e.name, e.data)), ...layout.end()];
  const out = new Uint8Array(layout.offset);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
