import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useHousehold } from '@/features/household/membership';
import { takeManualPrefill } from '@/features/import/manual';
import { useRecipe } from '@/features/recipes/data';
import { emptyDraft } from '@/features/recipes/draft';
import { RecipeEditor } from '@/features/recipes/recipe-editor';
import { useDraftState } from '@/hooks/use-draft-state';

/**
 * S-18: `/recipes/edit` adds a recipe; `/recipes/edit?id=<id>` edits one.
 * `/recipes/edit?from=import` is "enter manually instead" from an import (FR-AI-13), prefilled
 * with what the import had, and kept as its own draft.
 */
export default function RecipeEditRoute() {
  const { id, from } = useLocalSearchParams<{ id?: string; from?: string }>();
  const fromImport = !id && from === 'import';
  const [prefill] = useState(() => (fromImport ? takeManualPrefill() : null));
  const { state } = useHousehold();
  const { saved, loading } = useRecipe(id);
  const [fresh] = useState(() => randomUUID());
  // A new recipe keeps its ID with its draft, so a form restored after the app was killed
  // saves as the same recipe.
  const newKey = fromImport ? 'recipe:import-manual' : 'recipe:new';
  const [newId, , clearNewId] = useDraftState(`${newKey}:id`, fresh);

  if (state.status !== 'member' || state.membership.role === 'caregiver') return null;
  if (id && (loading || !saved)) return null;
  const { locale, region, unitSystem } = state.membership;
  return (
    <RecipeEditor
      key={id ?? newId}
      saved={id ? saved : null}
      recipeId={id ?? newId}
      draftKey={id ? `recipe:${id}` : newKey}
      initialDraft={prefill ? { ...emptyDraft(), ...prefill } : undefined}
      household={{ locale, region, unitSystem }}
      onSaved={(savedId) => {
        if (id) {
          router.back();
          return;
        }
        clearNewId();
        router.replace({ pathname: '/recipes/[id]', params: { id: savedId } });
      }}
    />
  );
}
