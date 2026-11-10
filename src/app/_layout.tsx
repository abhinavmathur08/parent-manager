import '@/i18n';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';

import { AuthProvider, useAuth } from '@/features/auth/session';
import { BiometricLock } from '@/features/biometric/biometric-lock';
import { useTheme } from '@/hooks/use-theme';

// S-01: the splash screen stays up until the saved session has been read.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootStack() {
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn';

  useEffect(() => {
    if (auth.status !== 'loading') SplashScreen.hideAsync().catch(() => undefined);
  }, [auth.status]);

  if (auth.status === 'loading') return null;

  return (
    <BiometricLock active={signedIn}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Screen name="auth-callback" />
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="gallery" />
        </Stack.Protected>
      </Stack>
    </BiometricLock>
  );
}

export default function RootLayout() {
  const theme = useTheme();
  const navigationTheme = useMemo(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.color.primary,
        background: theme.color.background,
        card: theme.color.surface,
        text: theme.color.text,
        border: theme.color.border,
        notification: theme.color.accent,
      },
    };
  }, [theme]);
  return (
    <ThemeProvider value={navigationTheme}>
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </ThemeProvider>
  );
}
