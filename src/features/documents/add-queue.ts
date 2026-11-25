import { randomUUID } from 'expo-crypto';
import { useEffect } from 'react';

import { onSignOut } from '@/features/auth/sign-out';
import { track } from '@/lib/analytics';

import { discardCapture, type Capture } from './capture';
import {
  putPendingUpload,
  removePendingUpload,
  setPendingState,
  type PendingUpload,
} from './pending-uploads';
import {
  finishUpload,
  isRetryable,
  sizeBucket,
  uploadDocument,
  UploadError,
  type DocumentDetails,
} from './upload';

type Job = {
  householdId: string;
  details: DocumentDetails;
  capture: Capture;
  /** The ID the next attempt uses. A new one after a half-finished attempt. */
  documentId: string;
  /** `begin` succeeded for `documentId`, so the server may hold a hidden row for it. */
  begun: boolean;
  running: boolean;
  /** Runs once the document is stored, such as attaching it to the event it was added from. */
  afterAdded?: (documentId: string) => Promise<void>;
};

// Memory only, like the drafts they back (pending-uploads.ts): files stay in the cache.
const jobs = new Map<string, Job>();

function pendingOf(id: string, job: Job, state: PendingUpload['state']): PendingUpload {
  return {
    id,
    householdId: job.householdId,
    title: job.details.title.trim(),
    category: job.details.category,
    personId: job.details.personId,
    expiresOn: job.details.expiresOn,
    state,
  };
}

function done(id: string, job: Job) {
  jobs.delete(id);
  // The document stays in the vault if this fails; the parent can attach it again.
  job.afterAdded?.(job.documentId).catch(() => undefined);
  removePendingUpload(id);
  discardCapture(job.capture);
  // Counts and fixed values only: never the title, category or person (FR2-DOC-11).
  track('document_added', {
    source: job.capture.source,
    pages_count: job.capture.files.length,
    size_bucket: sizeBucket(job.capture.files.reduce((sum, file) => sum + file.size, 0)),
  });
}

/** One attempt. Resolves `added`, or `waiting` when it'll be tried again; throws a refusal. */
async function attempt(id: string, job: Job): Promise<'added' | 'waiting'> {
  if (job.running) return 'waiting';
  job.running = true;
  setPendingState(id, 'uploading');
  try {
    if (job.begun) {
      // A lost answer may have hidden a finished upload: ask before starting again.
      try {
        await finishUpload(job.documentId);
        done(id, job);
        return 'added';
      } catch {
        job.documentId = randomUUID();
        job.begun = false;
      }
    }
    await uploadDocument({
      householdId: job.householdId,
      documentId: job.documentId,
      details: job.details,
      capture: job.capture,
      onBegun: () => (job.begun = true),
    });
    done(id, job);
    return 'added';
  } catch (error) {
    const code = error instanceof UploadError ? error.code : 'documents.failed';
    if (isRetryable(code)) {
      setPendingState(id, 'failed');
      return 'waiting';
    }
    jobs.delete(id);
    removePendingUpload(id);
    throw error instanceof UploadError ? error : new UploadError(code);
  } finally {
    job.running = false;
  }
}

/**
 * Adds a document from S-41 (FR2-DOC-2). Online it uploads now: `added` when stored, or
 * `waiting` if it failed in a way that may pass, when the vault shows it as waiting and it's
 * tried again. Offline it's kept as a draft on the device and uploads when online (spec 3.5,
 * "Offline"). A refusal (the limit, a file too large) throws an `UploadError` and keeps the
 * capture, so the screen can explain and the member can try again.
 */
export async function addDocument(input: {
  householdId: string;
  details: DocumentDetails;
  capture: Capture;
  online: boolean;
  afterAdded?: (documentId: string) => Promise<void>;
}): Promise<'added' | 'waiting'> {
  const id = randomUUID();
  const job: Job = {
    householdId: input.householdId,
    details: input.details,
    capture: input.capture,
    documentId: id,
    begun: false,
    running: false,
    afterAdded: input.afterAdded,
  };
  jobs.set(id, job);
  putPendingUpload(pendingOf(id, job, 'waiting'));
  if (!input.online) return 'waiting';
  return attempt(id, job);
}

/** Tries every waiting draft again. A refusal now drops the draft and its files. */
export async function retryPendingUploads(): Promise<void> {
  for (const [id, job] of [...jobs]) {
    try {
      await attempt(id, job);
    } catch {
      discardCapture(job.capture);
    }
  }
}

/** Uploads drafts whenever the device is online (NFR2-OFF-1). Mounted by the Household tab. */
export function usePendingUploadRunner(online: boolean): void {
  useEffect(() => {
    if (online) void retryPendingUploads();
  }, [online]);
}

function clearJobs() {
  for (const job of jobs.values()) discardCapture(job.capture);
  jobs.clear();
}

onSignOut(clearJobs);
