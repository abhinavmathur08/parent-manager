import { Stack } from 'expo-router';

/** The Recipes tab (S-16) and the screens it opens: the editor (S-18) and recipe detail (S-17). */
export default function RecipesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
