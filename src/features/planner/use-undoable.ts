import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A change that can be undone for 5 seconds (FR-PLAN-7, FR-PLAN-9). Deletes on the server
 * are final tombstones (architecture section 5), so a removal is held back instead: the
 * rows are hidden at once, and `commit` writes the removal when the undo bar goes away.
 */
export type Undoable = {
  /** The toast's message. */
  message: string;
  /** Entry IDs to hide until the change commits or is undone. */
  hidden: readonly string[];
  /** Writes the held-back part of the change. */
  commit: () => Promise<void>;
  /** Reverses any part already written. */
  undo?: () => Promise<void>;
};

/**
 * Holds one undoable change at a time. A new one commits the previous one first. Leaving
 * the screen commits what's held, so nothing is lost.
 */
export function useUndoable(onError: () => void) {
  const [current, setCurrent] = useState<Undoable | null>(null);
  const held = useRef<Undoable | null>(null);
  const reportError = useRef(onError);
  useEffect(() => {
    reportError.current = onError;
  });

  const run = useCallback((task: (() => Promise<void>) | undefined) => {
    task?.().catch(() => reportError.current());
  }, []);

  const hold = useCallback(
    (change: Undoable) => {
      if (held.current) run(held.current.commit);
      held.current = change;
      setCurrent(change);
    },
    [run],
  );

  /** The undo button. */
  const undo = useCallback(() => {
    const change = held.current;
    held.current = null;
    setCurrent(null);
    if (change) run(change.undo);
  }, [run]);

  /** The bar timed out or was dismissed: write the change. */
  const settle = useCallback(() => {
    const change = held.current;
    held.current = null;
    setCurrent(null);
    if (change) run(change.commit);
  }, [run]);

  useEffect(
    () => () => {
      if (held.current) run(held.current.commit);
      held.current = null;
    },
    [run],
  );

  return { current, hidden: current?.hidden ?? [], hold, undo, settle };
}
