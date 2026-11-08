import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabaseConfig } from '@/lib/supabase-config';

// Placeholder until the first Phase 1 feature from docs/backlog.md lands.
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.color.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <Text variant="screenTitle" testID="home-title">
          {t('home.title')}
        </Text>
        <Text variant="label" color="textSecondary" testID="supabase-status">
          {supabaseConfig
            ? t('home.supabaseStatus.configured')
            : t('home.supabaseStatus.notConfigured')}
        </Text>
      </SafeAreaView>
    </View>
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
    gap: space[2],
    paddingHorizontal: space[6],
  },
});
