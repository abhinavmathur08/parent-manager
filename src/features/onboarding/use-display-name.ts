import { useEffect, useState } from 'react';

import { useAuth } from '@/features/auth/session';
import { fetchDisplayName } from '@/features/onboarding/profile';

/** The signed-in user's display name: undefined while loading, null if there isn't one. */
export function useDisplayName(): string | null | undefined {
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const [loaded, setLoaded] = useState<{ userId: string; name: string | null } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchDisplayName(userId)
      .then((name) => active && setLoaded({ userId, name }))
      .catch(() => active && setLoaded({ userId, name: null }));
    return () => {
      active = false;
    };
  }, [userId]);

  return loaded && loaded.userId === userId ? loaded.name : undefined;
}
