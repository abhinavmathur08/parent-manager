import { Directory, Paths } from 'expo-file-system';
import { useEffect, useMemo } from 'react';

import { onSignOut } from '@/features/auth/sign-out';

// FR2-DOC-4: files are never kept on the device, except here while the viewer is open. Each open
// document gets a folder, deleted when its viewer closes, on sign-out, and at the next launch
// (in case the app was killed with a viewer open).
const ROOT = 'vault-viewer';

function folder(documentId: string): Directory {
  return new Directory(Paths.cache, ROOT, documentId);
}

/** The open document's cache folder, created if needed. */
export function openViewerCache(documentId: string): Directory {
  const dir = folder(documentId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function clearViewerCache(documentId: string): void {
  try {
    const dir = folder(documentId);
    if (dir.exists) dir.delete();
  } catch {
    // Already gone, or the cache was cleared by the system.
  }
}

export function clearAllViewerCaches(): void {
  try {
    const root = new Directory(Paths.cache, ROOT);
    if (root.exists) root.delete();
  } catch {
    // Nothing to clear.
  }
}

/** The viewer's cache folder for as long as the viewer is mounted. */
export function useViewerCache(documentId: string): Directory {
  const dir = useMemo(() => openViewerCache(documentId), [documentId]);
  useEffect(() => () => clearViewerCache(documentId), [documentId]);
  return dir;
}

onSignOut(clearAllViewerCaches);
clearAllViewerCaches();
