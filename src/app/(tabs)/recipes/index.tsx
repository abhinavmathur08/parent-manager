import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/placeholder-screen';

// Placeholder until the recipes feature from docs/backlog.md lands.
export default function RecipesScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('tabs.recipes')} icon="recipes" testID="recipes-screen" />;
}
