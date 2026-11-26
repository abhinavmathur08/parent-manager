// What a stored file's first bytes must be for its declared type (SR2-L3, #321). The bucket
// only checks the declared content type, so `finish` reads each file's start and refuses
// bytes that aren't a PDF, JPEG or PNG. The app runs the same check on picked files
// (src/features/documents/file-type.ts).

import type { Mime } from './handler.ts';

const SIGNATURES: Record<Mime, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** How many bytes `matchesType` needs from the start of a file. */
export const MAGIC_BYTES = 8;

export function matchesType(bytes: Uint8Array, mime: Mime): boolean {
  const signature = SIGNATURES[mime];
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}
