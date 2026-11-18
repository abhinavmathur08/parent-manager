import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDraftState } from '@/hooks/use-draft-state';

import {
  fetchJob,
  ImportError,
  startImport,
  type ImportErrorCode,
  type ImportInput,
  type ImportResult,
} from './api';

/** The import in progress, kept on the device so leaving and returning shows the result (S-20). */
export type PendingImport = { jobId: string; input: ImportInput; startedAt: number };

export type ImportRun =
  | { phase: 'idle' }
  | { phase: 'running'; pending: PendingImport }
  | { phase: 'succeeded'; pending: PendingImport; result: ImportResult; finishedAt: number }
  | { phase: 'failed'; pending: PendingImport; code: ImportErrorCode };

export const PENDING_IMPORT_KEY = 'import:pending';
/** How often a returning screen checks the job, and when it stops waiting (FR-AI-11 + margin). */
export const POLL_MS = 2_000;
export const GIVE_UP_MS = 75_000;
/** A job row that still doesn't exist this long after starting never reached the server. */
const MISSING_MS = 20_000;

// Requests still in flight, by job ID, so a screen that remounts waits on the same request
// instead of sending another.
const inflight = new Map<string, Promise<ImportResult>>();

function request(pending: PendingImport): Promise<ImportResult> {
  let promise = inflight.get(pending.jobId);
  if (!promise) {
    promise = startImport(pending.jobId, pending.input).finally(() =>
      inflight.delete(pending.jobId),
    );
    inflight.set(pending.jobId, promise);
  }
  return promise;
}

/**
 * Runs an import and keeps track of it across leaving the screen and the app being killed:
 * the server keeps going (S-20), and on return the job is read back by its ID.
 */
export function useImportRun(now: () => number = Date.now) {
  const [pending, setPending, clearPending] = useDraftState<PendingImport | null>(
    PENDING_IMPORT_KEY,
    null,
  );
  const [run, setRun] = useState<ImportRun>(() =>
    pending ? { phase: 'running', pending } : { phase: 'idle' },
  );
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const finish = useCallback(
    (p: PendingImport, outcome: { result: ImportResult } | { code: ImportErrorCode }) => {
      if (!active.current) return;
      setRun(
        'result' in outcome
          ? { phase: 'succeeded', pending: p, result: outcome.result, finishedAt: now() }
          : { phase: 'failed', pending: p, code: outcome.code },
      );
    },
    [now],
  );

  /** Waits for a job by reading it back, after a lost connection or a return to the screen. */
  const watch = useCallback(
    async (p: PendingImport) => {
      while (active.current) {
        let job;
        try {
          job = await fetchJob(p.jobId);
        } catch {
          job = { status: 'processing' as const };
        }
        if (job.status === 'succeeded') return finish(p, { result: job.result });
        if (job.status === 'failed') return finish(p, { code: job.code });
        const waited = now() - p.startedAt;
        if (job.status === 'missing' && waited > MISSING_MS) {
          return finish(p, { code: 'import.network' });
        }
        if (waited > GIVE_UP_MS) return finish(p, { code: 'import.timeout' });
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
    [finish, now],
  );

  /** Sends the import, or joins the request already in flight, and waits for its answer. */
  const send = useCallback(
    (p: PendingImport) => {
      request(p).then(
        (result) => finish(p, { result }),
        (error: unknown) => {
          const code = error instanceof ImportError ? error.code : 'import.failed';
          // No answer doesn't mean no import: the server may still finish it.
          if (code === 'import.network') void watch(p);
          else finish(p, { code });
        },
      );
    },
    [finish, watch],
  );

  // On return to the screen, pick up where the import got to: join the request if this app
  // session still has it in flight, otherwise read the job back.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !pending) return;
    resumed.current = true;
    if (inflight.has(pending.jobId)) send(pending);
    else void watch(pending);
  }, [pending, send, watch]);

  const start = useCallback(
    (input: ImportInput) => {
      const p: PendingImport = { jobId: randomUUID(), input, startedAt: now() };
      resumed.current = true;
      setPending(p);
      setRun({ phase: 'running', pending: p });
      send(p);
      return p;
    },
    [now, send, setPending],
  );

  /** Forgets the import on this device. The server may still finish it. */
  const reset = useCallback(() => {
    clearPending();
    setRun({ phase: 'idle' });
  }, [clearPending]);

  return { run, start, reset };
}
