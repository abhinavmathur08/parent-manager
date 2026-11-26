import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { onSignOut } from '@/features/auth/sign-out';

// FR2-DOC-4, SR2-M1 (#314): every file a capture makes or copies (scanned pages, photos,
// converted images, picked PDFs and PNGs) lives in one folder until it's uploaded or dropped.
// Drafts are kept in memory only, so a killed app can't name its files; the folder is deleted
// at launch and at sign-out instead, as the viewer's cache is (vault/viewer-cache.ts).
const ROOT = 'vault-capture';

/** Moves a file into the capture folder under a fresh name, and returns its new URI. */
export function intoCaptureFolder(uri: string): string {
  const dir = new Directory(Paths.cache, ROOT);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const ext = uri.split('/').pop()?.split('.').pop()?.toLowerCase() ?? 'bin';
  const target = new File(dir, `${randomUUID()}.${ext}`);
  new File(uri).moveSync(target);
  return target.uri;
}

/** Deletes every capture file. Only at launch and sign-out, when no draft can be waiting. */
export function clearCaptureFolder(): void {
  try {
    const dir = new Directory(Paths.cache, ROOT);
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to clear.
  }
}

onSignOut(clearCaptureFolder);
clearCaptureFolder();
