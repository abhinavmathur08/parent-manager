import '@/i18n';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';

import { AnalyticsIdentity } from '@/features/auth/analytics-identity';
// Registers the Google sign-out cleanup (FR-AUTH-7).
import '@/features/auth/google';
import { AuthProvider, useAuth } from '@/features/auth/session';
import { BiometricLock } from '@/features/biometric/biometric-lock';
import { AccessEnded } from '@/features/household/access-ended';
import { HouseholdUnavailable } from '@/features/household/household-unavailable';
import { HouseholdProvider, useHousehold } from '@/features/household/membership';
import { ForcedUpdateGate } from '@/features/remote-config/forced-update';
import { RemoteConfigProvider } from '@/features/remote-config/provider';
import { useTheme } from '@/hooks/use-theme';
import { initCrashReporting, wrapRoot } from '@/lib/crash-reporting';

// F-07.1: crash reporting starts first, so launch errors are caught (no-op without a DSN).
initCrashReporting();

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
  if (signedIn && household.status === 'ended') {
    return (
      <BiometricLock active>
        <AccessEnded
          reason={household.reason}
          householdId={household.householdId}
          householdName={household.householdName}
        />
      </BiometricLock>
    );
  }

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

function RootLayout() {
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
      <RemoteConfigProvider>
        <ForcedUpdateGate>
          <AuthProvider>
            <HouseholdProvider>
              <AnalyticsIdentity />
              <RootStack />
            </HouseholdProvider>
          </AuthProvider>
        </ForcedUpdateGate>
      </RemoteConfigProvider>
    </ThemeProvider>
  );
}

export default wrapRoot(RootLayout);
