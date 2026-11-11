import '@/i18n';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';

// Registers the Google sign-out cleanup (FR-AUTH-7).
import '@/features/auth/google';
import { AuthProvider, useAuth } from '@/features/auth/session';
import { BiometricLock } from '@/features/biometric/biometric-lock';
import { HouseholdUnavailable } from '@/features/household/household-unavailable';
import { HouseholdProvider, useHousehold } from '@/features/household/membership';
import { useTheme } from '@/hooks/use-theme';

// S-01: the splash screen stays up until the saved session has been read.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootStack() {
  const auth = useAuth();
  const household = useHousehold().state;
  const signedIn = auth.status === 'signedIn';
  const loading = auth.status === 'loading' || (signedIn && household.status === 'loading');

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => undefined);
  }, [loading]);

  if (loading) return null;
  if (signedIn && household.status === 'error') return <HouseholdUnavailable />;

  return (
    <BiometricLock active={signedIn}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={signedIn && household.status === 'member'}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && household.status === 'none'}>
          <Stack.Screen name="(onboarding)" />
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
        <HouseholdProvider>
          <RootStack />
        </HouseholdProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
