import { Redirect } from 'expo-router';

import { useHousehold } from '@/features/household/membership';
import { ImportScreen } from '@/features/import/import-screen';
import { useFeatureEnabled } from '@/features/remote-config/provider';

/** S-19 and S-20. Hidden by the `ai_import` kill switch, which leaves manual entry (AI-20). */
export default function RecipeImportRoute() {
  const { state } = useHousehold();
  const enabled = useFeatureEnabled('ai_import');
  // Caregivers can't import (FR-AI-16).
  if (state.status !== 'member' || state.membership.role === 'caregiver') return null;
  if (!enabled) return <Redirect href="/plan/recipes/edit" />;
  return <ImportScreen />;
}
