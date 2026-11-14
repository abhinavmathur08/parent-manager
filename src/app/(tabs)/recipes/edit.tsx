import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useHousehold } from '@/features/household/membership';
import { useRecipe } from '@/features/recipes/data';
import { RecipeEditor } from '@/features/recipes/recipe-editor';
import { useDraftState } from '@/hooks/use-draft-state';

/** S-18: `/recipes/edit` adds a recipe; `/recipes/edit?id=<id>` edits one. */
export default function RecipeEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state } = useHousehold();
  const { saved, loading } = useRecipe(id);
  const [fresh] = useState(() => randomUUID());
  // A new recipe keeps its ID with its draft, so a form restored after the app was killed
  // saves as the same recipe.
  const [newId, , clearNewId] = useDraftState('recipe:new:id', fresh);

  if (state.status !== 'member' || state.membership.role === 'caregiver') return null;
  if (id && (loading || !saved)) return null;
  const { locale, region, unitSystem } = state.membership;
  return (
    <RecipeEditor
      key={id ?? newId}
      saved={id ? saved : null}
      recipeId={id ?? newId}
      draftKey={id ? `recipe:${id}` : 'recipe:new'}
      household={{ locale, region, unitSystem }}
      onSaved={() => {
        if (!id) clearNewId();
        router.back();
      }}
    />
  );
}
