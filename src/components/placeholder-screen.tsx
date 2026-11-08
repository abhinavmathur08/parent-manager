import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import type { IconName } from '@/components/icon';
import { Screen } from '@/components/screen';

export type PlaceholderScreenProps = {
  /** Translated screen title. */
  title: string;
  icon: IconName;
  children?: ReactNode;
  testID: string;
};

/** A tab screen whose feature hasn't been built yet. */
export function PlaceholderScreen({ title, icon, children, testID }: PlaceholderScreenProps) {
  const { t } = useTranslation();
  return (
    <Screen title={title} testID={testID}>
      <EmptyState icon={icon} message={t('placeholder.comingSoon')} testID={`${testID}-empty`} />
      {children}
    </Screen>
  );
}
