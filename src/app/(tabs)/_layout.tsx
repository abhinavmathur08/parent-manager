import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { FloatingTabBar, TabButton } from '@/components/floating-tab-bar';
import type { IconName } from '@/components/icon';
import '@/features/calendar/sync';
import '@/features/documents/sync';
import '@/features/grocery/sync';
import { GroceryListKeeper } from '@/features/grocery/keeper';
import { useHousehold } from '@/features/household/membership';
import '@/features/ingredients/sync';
import { useAuth } from '@/features/auth/session';
import { BusyDayPublisher } from '@/features/calendar/busy-publisher';
import { DefrostScheduler } from '@/features/notifications/defrost-scheduler';
import { EventReminderScheduler } from '@/features/notifications/event-reminder-scheduler';
import { NotificationResponses } from '@/features/notifications/notification-responses';
import { PushRegistration } from '@/features/notifications/push-registration';
import '@/features/planner/sync';
import '@/features/recipes/sync';
import { HistorySync } from '@/features/subscription/history-sync';
import { FirstLoadGate, PendingChangesBanner, SyncProvider } from '@/lib/sync';

const TABS: readonly {
  name: string;
  href: '/plan' | '/calendar' | '/list' | '/recipes' | '/household';
  icon: IconName;
}[] = [
  { name: 'plan', href: '/plan', icon: 'plan' },
  // Second, as FR2-CAL-1 says.
  { name: 'calendar', href: '/calendar', icon: 'calendar' },
  { name: 'list', href: '/list', icon: 'list' },
  { name: 'recipes', href: '/recipes', icon: 'recipes' },
  { name: 'household', href: '/household', icon: 'household' },
];

/** The main app: Plan, Calendar, List, Recipes and Household, under the floating tab bar (architecture section 2). */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { state } = useHousehold();
  const auth = useAuth();
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
      <FirstLoadGate>
        {tabs}
        <GroceryListKeeper />
        <HistorySync />
        <PushRegistration />
        {auth.status === 'signedIn' ? (
          <>
            <NotificationResponses userId={auth.session.user.id} />
            <DefrostScheduler userId={auth.session.user.id} />
            <EventReminderScheduler userId={auth.session.user.id} membership={state.membership} />
            <BusyDayPublisher userId={auth.session.user.id} />
          </>
        ) : null}
        <PendingChangesBanner />
      </FirstLoadGate>
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
