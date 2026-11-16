import type { RecipeDraft } from '@/features/recipes/draft';

// What "enter manually instead" carries to the recipe editor (FR-AI-13): any title, the
// pasted text in notes, or the link as the source. Held in memory only, for the one hop.
let prefill: Partial<RecipeDraft> | null = null;

export function setManualPrefill(value: Partial<RecipeDraft>): void {
  prefill = value;
}

/** Returns the prefill once, then forgets it. */
export function takeManualPrefill(): Partial<RecipeDraft> | null {
  const value = prefill;
  prefill = null;
  return value;
}
