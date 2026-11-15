import { Stack } from 'expo-router';

/** The Plan tab (S-10) and the notifications inbox (S-24), opened from its header bell. */
export default function PlanLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
