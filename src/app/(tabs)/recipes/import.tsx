import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/placeholder-screen';

// Placeholder until the import screens (R-06.1) land; S-16's empty state already offers import.
export default function RecipeImportRoute() {
  const { t } = useTranslation();
  return (
    <PlaceholderScreen title={t('recipes.import')} icon="recipes" testID="recipe-import-screen">
      {null}
    </PlaceholderScreen>
  );
}
