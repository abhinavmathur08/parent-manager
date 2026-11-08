import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/placeholder-screen';

// Placeholder until the plan feature from docs/backlog.md lands.
export default function PlanScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('tabs.plan')} icon="plan" testID="plan-screen" />;
}
