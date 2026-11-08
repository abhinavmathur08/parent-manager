import { Redirect } from 'expo-router';

/** The app opens on the Plan tab (architecture section 2). */
export default function Index() {
  return <Redirect href="/plan" />;
}
