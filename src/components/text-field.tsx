import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Icon } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type TextFieldProps = Omit<
  TextInputProps,
  'style' | 'editable' | 'placeholderTextColor' | 'allowFontScaling' | 'accessibilityLabel'
> & {
  /** `search` adds a leading search icon and a clear button. */
  variant?: 'filled' | 'search';
  /** A visible, translated label. Omit only for search fields, which then need `accessibilityLabel`. */
  label?: string;
  /** Read by screen readers. Defaults to `label`. */
  accessibilityLabel?: string;
  /** A translated error. Shown as text under the field, never by color alone. */
  error?: string;
  /** Translated helper text under the field. */
  hint?: string;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/** Section 8 TextField: height 52 (a minimum), with focused, filled, error and disabled states. */
export function TextField({
  variant = 'filled',
  label,
  accessibilityLabel,
  error,
  hint,
  disabled = false,
  testID,
  style,
  value,
  onChangeText,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? theme.color.error
    : focused
      ? theme.color.primary
      : theme.color.surfaceAlt;
  const fontSize = theme.type.body.fontSize * theme.fontScale;
  const showClear = variant === 'search' && !!value && !disabled;

  return (
    <View style={[{ gap: theme.space[1] }, style]}>
      {label ? (
        <Text variant="label" color="textSecondary" nativeID={`${testID}-label`}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            minHeight: 52,
            borderRadius: theme.radius.control,
            borderWidth: 1.5,
            borderColor,
            backgroundColor: focused ? theme.color.surface : theme.color.surfaceAlt,
            paddingStart: theme.space[4],
            paddingEnd: showClear ? 0 : theme.space[4],
            gap: theme.space[2],
            opacity: disabled ? 0.6 : 1,
          },
        ]}
      >
        {variant === 'search' ? <Icon name="search" size="sm" color="textSecondary" /> : null}
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityLabelledBy={label ? `${testID}-label` : undefined}
          accessibilityHint={error ?? hint}
          accessibilityState={{ disabled }}
          placeholderTextColor={theme.color.textSecondary}
          selectionColor={theme.color.primary}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            theme.type.body,
            {
              fontSize,
              // A line height on a single-line input clips text on iOS; let the font decide.
              lineHeight: undefined,
              color: theme.color.text,
              paddingVertical: theme.space[3],
            },
          ]}
          {...inputProps}
        />
        {showClear ? (
          <IconButton
            icon="clear"
            color="textSecondary"
            accessibilityLabel={t('components.textField.clear')}
            onPress={() => onChangeText?.('')}
            testID={`${testID}-clear`}
          />
        ) : null}
      </View>
      {error ? (
        <View style={[styles.message, { gap: theme.space[1] }]}>
          <Icon name="warning" size="sm" color="error" />
          <Text
            variant="caption"
            color="error"
            style={styles.messageText}
            testID={`${testID}-error`}
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="caption" color="textSecondary" testID={`${testID}-hint`}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  messageText: {
    flex: 1,
  },
});
