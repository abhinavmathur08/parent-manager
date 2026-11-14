import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

/**
 * "Copy last week" into a week that already has entries (FR-PLAN-9): add last week's
 * entries alongside, or replace this week's. Replacing shows an undo bar afterwards.
 */
export function CopyWeekSheet({
  visible,
  count,
  onChoose,
  onClose,
}: {
  visible: boolean;
  /** How many entries last week has. */
  count: number;
  onChoose: (mode: 'add' | 'replace') => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('plan.copy.title')}
      testID="copy-week-sheet"
    >
      <View style={{ gap: theme.space[3] }}>
        <Text color="textSecondary">{t('plan.copy.message', { count })}</Text>
        <Button
          label={t('plan.copy.add')}
          onPress={() => onChoose('add')}
          fullWidth
          testID="copy-week-add"
        />
        <Button
          variant="secondary"
          label={t('plan.copy.replace')}
          onPress={() => onChoose('replace')}
          fullWidth
          testID="copy-week-replace"
        />
      </View>
    </BottomSheet>
  );
}
