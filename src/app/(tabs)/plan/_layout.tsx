import { Stack } from 'expo-router';

/**
 * The Plan tab (S-10) and the screens it opens: the notifications inbox (S-24), from its header
 * bell, history (S-34), and Recipes (S-16 to S-21) from its header since Tasks took the Recipes
 * tab's slot (D-29).
 */
export default function PlanLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
