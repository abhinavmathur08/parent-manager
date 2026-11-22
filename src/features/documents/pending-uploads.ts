import { useSyncExternalStore } from 'react';

import { onSignOut } from '@/features/auth/sign-out';

import type { DocumentCategory } from './tables';

/**
 * A document added on this device that isn't stored yet (spec 3.5, "Offline": adding is
 * queued only as a draft on the device and uploads when online). The server creates the
 * document row only when the upload starts, and nobody sees it until it's finished, so until
 * then the vault shows this instead, as "waiting to upload" (S-40).
 *
 * Kept in memory only, with its files in the app's cache: the title is the member's own text,
 * and nothing about a document is written to the device's storage (FR2-DOC-4, D-17). A draft
 * goes with the app process and on sign-out.
 */
export type PendingUpload = {
  /** The document ID the upload will use, so a retry never makes a second document. */
  id: string;
  householdId: string;
  title: string;
  category: DocumentCategory;
  personId: string | null;
  expiresOn: string | null;
  /** `waiting` for a connection, `uploading` now, or `failed` and waiting for a retry. */
  state: 'waiting' | 'uploading' | 'failed';
};

let items: readonly PendingUpload[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function pendingUploads(): readonly PendingUpload[] {
  return items;
}

export function putPendingUpload(item: PendingUpload): void {
  items = [...items.filter((other) => other.id !== item.id), item];
  emit();
}

export function setPendingState(id: string, state: PendingUpload['state']): void {
  items = items.map((item) => (item.id === id ? { ...item, state } : item));
  emit();
}

export function removePendingUpload(id: string): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

export function clearPendingUploads(): void {
  items = [];
  emit();
}

/** This household's drafts waiting to upload, in the order they were added. */
export function usePendingUploads(householdId: string): readonly PendingUpload[] {
  const all = useSyncExternalStore(subscribe, pendingUploads, pendingUploads);
  return all.filter((item) => item.householdId === householdId);
}

onSignOut(clearPendingUploads);
