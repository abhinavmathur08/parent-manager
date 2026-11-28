import { useEffect, useRef } from 'react';

/**
 * An in-memory channel from task detail (S-46) to the Tasks tab: a delete asked for on detail is
 * held behind the list's undo bar (FR3-TASK-8, NFR-REL-5), since detail closes at once. Nothing
 * here is stored; a request with no list mounted is dropped, and detail falls back to writing it.
 */
const listeners = new Set<(taskId: string) => void>();

/** Hands a delete to the Tasks tab. False when no list is listening. */
export function requestTaskDelete(taskId: string): boolean {
  if (listeners.size === 0) return false;
  for (const listener of listeners) listener(taskId);
  return true;
}

export function useTaskDeleteRequests(handler: (taskId: string) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = (taskId: string) => latest.current(taskId);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
