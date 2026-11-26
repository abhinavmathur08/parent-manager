import { File } from 'expo-file-system';

import type { DocumentMime } from './tables';

// The first bytes each stored type starts with (SR2-L3, #321). The documents function checks
// them in `finish` too (supabase/functions/documents/magic.ts); this only refuses a misnamed
// file before it's uploaded.
const SIGNATURES: Record<DocumentMime, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

export function matchesType(bytes: Uint8Array, mime: DocumentMime): boolean {
  const signature = SIGNATURES[mime];
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

/** Whether a file on the device starts as its type should. Reads 8 bytes, not the file. */
export function fileMatchesType(uri: string, mime: DocumentMime): boolean {
  const handle = new File(uri).open();
  try {
    return matchesType(handle.readBytesSync(8), mime);
  } finally {
    handle.close();
  }
}
