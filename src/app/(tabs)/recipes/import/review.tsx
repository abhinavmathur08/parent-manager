import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/placeholder-screen';

// Placeholder until the review screen (S-21, R-06.2) lands.
export default function ImportReviewRoute() {
  const { t } = useTranslation();
  return (
    <PlaceholderScreen
      title={t('importRecipe.review.title')}
      icon="recipes"
      testID="import-review"
    />
  );
}
