import { useRef, useState, type ComponentRef } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export const CODE_LENGTH = 6;

/** Keeps only ASCII digits, up to the code length, so a pasted "123 456" or "Code: 123456" works. */
export function sanitizeCode(text: string, length = CODE_LENGTH): string {
  return text.replace(/[^0-9]/g, '').slice(0, length);
}

export type CodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Called once all cells are filled. */
  onComplete?: (code: string) => void;
  /** Translated label for the field ("Code from your email"). */
  accessibilityLabel: string;
  /** Translated error, shown as text under the cells. */
  error?: string;
  autoFocus?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Section 8 CodeInput: six cells over one real field, so pasting and the platform's one-time
 * code autofill both work. Screen readers see only the field, with its label and value.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  accessibilityLabel,
  error,
  autoFocus,
  testID,
  style,
}: CodeInputProps) {
  const theme = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const digits = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? '');

  return (
    <View style={[{ gap: theme.space[2] }, style]}>
      <Pressable
        onPress={() => input.current?.focus()}
        accessible={false}
        importantForAccessibility="no"
        style={[styles.cells, { gap: theme.space[2] }]}
      >
        {digits.map((digit, index) => {
          const current = focused && index === Math.min(value.length, CODE_LENGTH - 1);
          return (
            <View
              key={index}
              testID={`${testID}-cell-${index}`}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={[
                styles.cell,
                {
                  minHeight: theme.layout.minRowHeight,
                  borderRadius: theme.radius.control,
                  borderWidth: current || error ? 2 : 1.5,
                  borderColor: error
                    ? theme.color.error
                    : current
                      ? theme.color.primary
                      : theme.color.border,
                  backgroundColor: current ? theme.color.surface : theme.color.surfaceAlt,
                },
              ]}
            >
              <Text variant="sheetTitle" tabular style={styles.digit}>
                {digit}
              </Text>
            </View>
          );
        })}
        <TextInput
          ref={input}
          testID={testID}
          value={value}
          onChangeText={(text) => {
            const next = sanitizeCode(text);
            onChange(next);
            if (next.length === CODE_LENGTH) onComplete?.(next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={autoFocus}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH * 2}
          caretHidden
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={error}
          style={styles.hiddenInput}
        />
      </Pressable>
      {error ? (
        <View style={[styles.error, { gap: theme.space[1] }]}>
          <Icon name="warning" size="sm" color="error" />
          <Text
            variant="caption"
            color="error"
            style={styles.errorText}
            accessibilityLiveRegion="polite"
            testID={`${testID}-error`}
          >
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cells: {
    flexDirection: 'row',
    // Digits read in entry order even in right-to-left languages.
    direction: 'ltr',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    textAlign: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    // Nearly invisible but still focusable and tappable, which opacity 0 isn't on every platform.
    opacity: 0.011,
    color: 'transparent',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  errorText: {
    flex: 1,
  },
});
