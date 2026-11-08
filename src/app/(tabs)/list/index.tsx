import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/placeholder-screen';

// Placeholder until the list feature from docs/backlog.md lands.
export default function ListScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('tabs.list')} icon="list" testID="list-screen" />;
}
