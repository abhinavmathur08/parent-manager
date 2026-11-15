import { View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { RadioOption } from '@/components/radio-option';
import { useTheme } from '@/hooks/use-theme';

export type Choice<T extends string | number> = { value: T; label: string };

/** A sheet of radio options for one setting, such as a weekday or an hour. Choosing closes it. */
export function ChoiceSheet<T extends string | number>({
  visible,
  title,
  choices,
  selected,
  onChoose,
  onClose,
  testID,
}: {
  visible: boolean;
  title: string;
  choices: readonly Choice<T>[];
  selected: T;
  onChoose: (value: T) => void;
  onClose: () => void;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} testID={testID}>
      <View style={{ gap: theme.space[2] }}>
        {choices.map((choice) => (
          <RadioOption
            key={String(choice.value)}
            label={choice.label}
            selected={choice.value === selected}
            onPress={() => onChoose(choice.value)}
            testID={`${testID}-${choice.value}`}
          />
        ))}
      </View>
    </BottomSheet>
  );
}
