import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/session';

/** Signed in, the app opens on the Plan tab (architecture section 2); otherwise on sign-in. */
export default function Index() {
  const auth = useAuth();
  if (auth.status === 'loading') return null;
  return <Redirect href={auth.status === 'signedIn' ? '/plan' : '/sign-in'} />;
}
