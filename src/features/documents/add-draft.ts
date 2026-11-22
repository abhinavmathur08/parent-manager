import { useSyncExternalStore } from 'react';

import { onSignOut } from '@/features/auth/sign-out';

import { discardCapture, type Capture } from './capture';
import type { DocumentCategory } from './tables';

/**
 * S-41's form, outside the screen. Taking a photo can send the app to the background on
 * Android, and the vault lock unmounts vault screens while the app is away (FR2-DOC-3), so the
 * capture and the fields live here until the parent saves or leaves. Memory only.
 */
export type AddDraft = {
  capture: Capture | null;
  title: string;
  category: DocumentCategory | null;
  personId: string | null;
  /** `YYYY-MM-DD`, or null for no expiry. */
  expiresOn: string | null;
};

export const EMPTY_DRAFT: AddDraft = {
  capture: null,
  title: '',
  category: null,
  personId: null,
  expiresOn: null,
};

let draft: AddDraft = EMPTY_DRAFT;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const read = () => draft;

export function updateAddDraft(change: Partial<AddDraft>): void {
  draft = { ...draft, ...change };
  for (const listener of listeners) listener();
}

/** Starts over. `keepFiles` when the capture was handed on to an upload. */
export function resetAddDraft({ keepFiles = false } = {}): void {
  if (!keepFiles && draft.capture) discardCapture(draft.capture);
  updateAddDraft(EMPTY_DRAFT);
}

export function useAddDraft(): AddDraft {
  return useSyncExternalStore(subscribe, read, read);
}

/** Whether S-41 can save: a file, a title and a category (FR2-DOC-2). */
export function canSaveDraft(value: AddDraft): boolean {
  return value.capture !== null && value.title.trim().length > 0 && value.category !== null;
}

onSignOut(() => resetAddDraft());
