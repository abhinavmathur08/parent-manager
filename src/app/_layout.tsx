import '@/i18n';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';

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
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
