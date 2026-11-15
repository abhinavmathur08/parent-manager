import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { onSignOut } from '@/features/auth/sign-out';
import { usePlanRows } from '@/features/planner/data';
import { useRecipeRows } from '@/features/recipes/data';
import { DEFAULT_CHANNEL_ID, readPushPermission } from '@/lib/notifications/push';

import { DEFROST_ID_PREFIX, defrostSchedule, type DefrostReminder } from './defrost';
import { cachedPrefs, onPrefsChanged } from './prefs';

type Text = (reminder: DefrostReminder) => { title: string; body: string };

const signature = (r: DefrostReminder) => `${r.date}|${r.fireAt.getTime()}|${r.meal}`;

/**
 * Makes this device's scheduled "defrost tonight" notifications match `desired`: ones for
 * entries that moved, changed or went are cancelled or replaced, and new ones scheduled.
 * Other scheduled notifications are left alone.
 */
export async function reconcileDefrost(desired: readonly DefrostReminder[], text: Text) {
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) =>
    n.identifier.startsWith(DEFROST_ID_PREFIX),
  );
  const missing = new Map(desired.map((r) => [r.id, r]));
  for (const existing of scheduled) {
    const wanted = missing.get(existing.identifier);
    if (wanted && existing.content.data?.signature === signature(wanted)) {
      missing.delete(existing.identifier);
    } else {
      await Notifications.cancelScheduledNotificationAsync(existing.identifier);
    }
  }
  for (const reminder of missing.values()) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: {
        ...text(reminder),
        data: {
          type: 'defrost',
          entryId: reminder.entryId,
          date: reminder.date,
          signature: signature(reminder),
        },
        categoryIdentifier: 'defrost',
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.fireAt,
        channelId: DEFAULT_CHANNEL_ID,
      },
    });
  }
}

/** The device's local date, `YYYY-MM-DD`: local notifications follow the device (spec AS-7). */
function localToday(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// The reminders name household meals, so they don't outlive the session on this device.
onSignOut(() => reconcileDefrost([], () => ({ title: '', body: '' })));

/**
 * Keeps "defrost tonight" (FR-NOT-5) scheduled on this device from the synced plan: when the
 * plan or recipes change, when the member changes their settings, and when the app returns
 * to the foreground. Nothing is scheduled while the type is off or permission isn't granted.
 */
export function DefrostScheduler({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { entries, loading: planLoading } = usePlanRows();
  const { recipes, loading: recipesLoading } = useRecipeRows();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') bump();
    });
    const prefs = onPrefsChanged(bump);
    return () => {
      appState.remove();
      prefs();
    };
  }, []);

  useEffect(() => {
    if (planLoading || recipesLoading) return;
    let cancelled = false;
    void (async () => {
      const prefs = cachedPrefs(userId);
      const allowed = prefs.defrost && (await readPushPermission()) === 'granted';
      if (cancelled) return;
      const now = new Date();
      const desired = allowed
        ? defrostSchedule({
            entries,
            recipes,
            today: localToday(now),
            now,
            quietStartMinute: prefs.quietStartMinute,
            quietEndMinute: prefs.quietEndMinute,
          })
        : [];
      await reconcileDefrost(desired, (reminder) => ({
        title: t('notifications.defrost.title'),
        body: t('notifications.defrost.body', { meal: reminder.meal }),
      }));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entries, recipes, planLoading, recipesLoading, userId, tick, t]);

  return null;
}
