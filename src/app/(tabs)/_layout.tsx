import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { FloatingTabBar, TabButton } from '@/components/floating-tab-bar';
import type { IconName } from '@/components/icon';
import { useHousehold } from '@/features/household/membership';
import '@/features/recipes/sync';
import { PendingChangesBanner, SyncProvider } from '@/lib/sync';

const TABS: readonly {
  name: string;
  href: '/plan' | '/list' | '/recipes' | '/household';
  icon: IconName;
}[] = [
  { name: 'plan', href: '/plan', icon: 'plan' },
  { name: 'list', href: '/list', icon: 'list' },
  { name: 'recipes', href: '/recipes', icon: 'recipes' },
  { name: 'household', href: '/household', icon: 'household' },
];

/** The main app: Plan, List, Recipes and Household, under the floating tab bar (architecture section 2). */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { state } = useHousehold();
  const tabs = (
    <Tabs style={styles.fill}>
      <TabSlot style={styles.fill} />
      <FloatingTabBar accessibilityLabel={t('tabs.label')} testID="tab-bar">
        {TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} asChild>
            <TabButton icon={tab.icon} label={t(`tabs.${tab.name}`)} testID={`tab-${tab.name}`} />
          </TabTrigger>
        ))}
      </FloatingTabBar>
      {/* Declares the routes; the visible bar above is built from triggers with the same names. */}
      <TabList style={styles.hidden}>
        {TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} href={tab.href} />
        ))}
      </TabList>
    </Tabs>
  );
  // The root layout only shows the tabs to members; the household's data syncs while they're open.
  return state.status === 'member' ? (
    <SyncProvider householdId={state.membership.householdId}>
      {tabs}
      <PendingChangesBanner />
    </SyncProvider>
  ) : (
    tabs
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
});
