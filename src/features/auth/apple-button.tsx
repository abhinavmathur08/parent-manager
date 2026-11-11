import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { PRESSED_OPACITY } from '@/components/focus-ring';
import { Text } from '@/components/text';
import { isAppleCancel, signInWithAppleNative } from '@/features/auth/apple';
import { appleWebSignInEnabled } from '@/features/auth/provider-config';
import { signInWithBrowser } from '@/features/auth/social';
import { useTheme } from '@/hooks/use-theme';

export type AppleButtonProps = {
  disabled?: boolean;
  /** Called with a translation key when sign-in fails. A cancel calls nothing. */
  onError: (error: unknown) => void;
  testID?: string;
};

/**
 * Whether to offer Sign in with Apple: on iOS when the device supports it, on Android once
 * Apple's web sign-in is configured.
 */
export function useAppleSignInAvailable(): boolean {
  const [nativeAvailable, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((value) => active && setAvailable(value))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return Platform.OS === 'ios' ? nativeAvailable : appleWebSignInEnabled;
}

/**
 * "Continue with Apple" (FR-AUTH-1). On iOS it's Apple's own button, which follows Apple's
 * guidelines by construction: black in light mode, white in dark. On Android it's drawn to
 * match (same colors, label and minimum size) and opens Apple's web sign-in. Render it only
 * when `useAppleSignInAvailable()` is true.
 */
export function AppleButton({ disabled, onError, testID = 'sign-in-apple' }: AppleButtonProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  async function press() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await (Platform.OS === 'ios' ? signInWithAppleNative() : signInWithBrowser('apple'));
    } catch (error) {
      if (!isAppleCancel(error)) onError(error);
    } finally {
      setBusy(false);
    }
  }

  const dark = theme.scheme === 'dark';
  const height = theme.layout.minTarget + theme.space[1];

  if (Platform.OS === 'ios') {
    return (
      <View
        testID={testID}
        pointerEvents={disabled || busy ? 'none' : 'auto'}
        style={{ opacity: disabled ? DISABLED_OPACITY : 1 }}
        accessibilityState={{ disabled: !!disabled, busy }}
      >
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            dark
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={theme.radius.control}
          style={{ width: '100%', height }}
          onPress={press}
        />
      </View>
    );
  }

  // Apple's colors for its button, which aren't design-system colors: pure black or white.
  // Disabled follows the design system's Button: surfaceAlt fill, textSecondary label.
  const background = disabled ? theme.color.surfaceAlt : dark ? APPLE_WHITE : APPLE_BLACK;
  const foreground = disabled ? theme.color.textSecondary : dark ? APPLE_BLACK : APPLE_WHITE;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('auth.apple.continue')}
      accessibilityState={{ disabled: !!disabled, busy }}
      disabled={disabled || busy}
      onPress={press}
      testID={testID}
      style={({ pressed }) => [
        styles.android,
        {
          minHeight: height,
          borderRadius: theme.radius.control,
          backgroundColor: background,
          paddingHorizontal: theme.space[4],
          opacity: pressed ? PRESSED_OPACITY : 1,
        },
      ]}
    >
      <Text variant="bodyStrong" style={{ color: foreground, textAlign: 'center' }}>
        {t('auth.apple.continue')}
      </Text>
    </Pressable>
  );
}

// Apple's native button can't be recolored, so a disabled one (offline) is dimmed instead.
const DISABLED_OPACITY = 0.4;
const APPLE_BLACK = '#000000';
const APPLE_WHITE = '#FFFFFF';

const styles = StyleSheet.create({
  android: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
