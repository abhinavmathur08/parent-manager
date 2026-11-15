import { useCallback, useEffect, useRef, useState } from 'react';

import { cachedPrefs, fetchPrefs, savePrefs, type NotificationPrefs } from './prefs';

/**
 * The member's notification settings: the cached copy at once, then the server's. `save`
 * shows a change straight away and puts the previous settings back if the server refuses it.
 */
export function useNotificationPrefs(userId: string): {
  prefs: NotificationPrefs;
  loaded: boolean;
  save: (next: NotificationPrefs) => Promise<void>;
} {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => cachedPrefs(userId));
  const [loaded, setLoaded] = useState(false);
  const current = useRef(prefs);

  useEffect(() => {
    let active = true;
    fetchPrefs(userId)
      .then((next) => {
        if (!active) return;
        current.current = next;
        setPrefs(next);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const save = useCallback(
    async (next: NotificationPrefs) => {
      const previous = current.current;
      current.current = next;
      setPrefs(next);
      try {
        await savePrefs(userId, next);
      } catch (error) {
        current.current = previous;
        setPrefs(previous);
        throw error;
      }
    },
    [userId],
  );

  return { prefs, loaded, save };
}
