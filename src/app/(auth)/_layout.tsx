import { Stack } from 'expo-router';

/** S-02 and S-03, shown only while signed out (see the root layout). */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
