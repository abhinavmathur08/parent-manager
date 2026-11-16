import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { AllowanceNotice } from '@/features/subscription/allowance-notice';

// Placeholder until the import screens (R-06.1) land; S-16's empty state already offers import.
// The allowance notice is the AI-allowance moment of need (FR-AI-10, FR-PAY-5).
export default function RecipeImportRoute() {
  const { t } = useTranslation();
  return (
    <PlaceholderScreen title={t('recipes.import')} icon="recipes" testID="recipe-import-screen">
      <AllowanceNotice />
    </PlaceholderScreen>
  );
}
