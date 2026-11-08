import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabaseConfig } from '@/lib/supabase-config';

// Placeholder until the first Phase 1 feature from docs/backlog.md lands.
export default function HomeScreen() {
  const { t } = useTranslation();
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" testID="home-title">
          {t('home.title')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" testID="supabase-status">
          {supabaseConfig
            ? t('home.supabaseStatus.configured')
            : t('home.supabaseStatus.notConfigured')}
        </ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
});
