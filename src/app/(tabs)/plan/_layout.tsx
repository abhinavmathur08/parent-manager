import { Stack } from 'expo-router';

/**
 * The Plan tab (S-10) and the screens it opens: the notifications inbox (S-24), from its header
 * bell, and history (S-34).
 */
export default function PlanLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
