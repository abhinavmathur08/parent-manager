import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { RadioOption } from '@/components/radio-option';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import type { PlanDate } from '@/features/planner/week';

const CHOICES = [
  { busy: true, key: 'busy' },
  { busy: false, key: 'notBusy' },
  { busy: null, key: 'auto' },
] as const;

/**
 * Marks a day "busy" or "not busy", overriding the rule, or hands it back to the rule
 * (FR2-BUSY-4). One tap applies.
 */
export function BusyMarkSheet({
  date,
  current,
  onChoose,
  onClose,
}: {
  /** The day being marked; the sheet is closed when null. */
  date: PlanDate | null;
  current: boolean | null;
  onChoose: (busy: boolean | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <BottomSheet
      visible={date !== null}
      onClose={onClose}
      title={t('busy.mark.title')}
      testID="busy-mark-sheet"
    >
      <View style={{ gap: theme.space[3] }}>
        <Text color="textSecondary">{t('busy.mark.message')}</Text>
        {CHOICES.map((choice) => (
          <RadioOption
            key={choice.key}
            label={t(`busy.mark.${choice.key}`)}
            description={t(`busy.mark.${choice.key}Detail`)}
            selected={current === choice.busy}
            onPress={() => onChoose(choice.busy)}
            testID={`busy-mark-${choice.key}`}
          />
        ))}
      </View>
    </BottomSheet>
  );
}
