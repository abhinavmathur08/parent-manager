import type { TFunction } from 'i18next';
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { onSignOut } from '@/features/auth/sign-out';
import { householdTimeZone } from '@/features/calendar/agenda';
import { useCalendarRows } from '@/features/calendar/data';
import { wallTime } from '@/features/calendar/repeat';
import { useCalendarMembers } from '@/features/calendar/use-members';
import type { Member } from '@/features/household/members';
import type { Membership } from '@/features/household/membership';
import { addDays } from '@/features/planner/week';
import { useEntitlement } from '@/features/subscription/entitlement';
import { formatDate, formatTime } from '@/i18n';
import { readPushPermission } from '@/lib/notifications/push';

import { onEventDetailsChanged, showEventDetails } from './event-details';
import {
  EVENT_REMINDER_ID_PREFIX,
  eventReminderSchedule,
  type EventReminder,
} from './event-reminders';
import { setLocalNotifications, type LocalNotification } from './local-budget';
import { cachedPrefs, onPrefsChanged } from './prefs';

export type ReminderTextOptions = {
  t: TFunction;
  locale: string;
  timeZone: string;
  userId: string;
  members: readonly Member[];
  /** "Show event details in notifications" (FR2-REM-3). */
  details: boolean;
};

/**
 * A reminder's text (FR2-REM-3): the kind, time and taking member only, unless the member
 * turned event details on, which adds the title and place. Notes and people never appear.
 */
export function eventReminderText(
  reminder: EventReminder,
  { t, locale, timeZone, userId, members, details }: ReminderTextOptions,
): { title: string; body: string } {
  const startDate = wallTime(reminder.startsAt.getTime(), timeZone).date;
  const fireDate = wallTime(reminder.fireAt.getTime(), timeZone).date;
  const day =
    startDate === fireDate
      ? t('notifications.event.today')
      : startDate === addDays(fireDate, 1)
        ? t('notifications.event.tomorrow')
        : formatDate(reminder.startsAt, locale, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            timeZone,
          });
  const when = reminder.allDay
    ? t('notifications.event.allDay', { day })
    : t('notifications.event.when', {
        day,
        time: formatTime(reminder.startsAt, locale, timeZone),
      });
  const taker = reminder.takingUserId;
  const name = taker ? members.find((m) => m.userId === taker)?.displayName : null;
  const taking = !taker
    ? t('notifications.event.takingNobody')
    : taker === userId
      ? t('notifications.event.takingYou')
      : name
        ? t('notifications.event.taking', { name })
        : t('notifications.event.takingMember');
  const kind = t(`calendar.kinds.${reminder.kind.replace('kind.', '')}`);
  if (!details) {
    return { title: kind, body: t('notifications.event.body', { when, taking }) };
  }
  return {
    title: reminder.title,
    body: reminder.place
      ? t('notifications.event.bodyWithPlace', { when, place: reminder.place, taking })
      : t('notifications.event.body', { when, taking }),
  };
}

/** The local notification for a reminder: opens the occurrence's detail. IDs only in `data`. */
export function eventReminderNotification(
  reminder: EventReminder,
  text: { title: string; body: string },
): LocalNotification {
  return {
    id: reminder.id,
    fireAt: reminder.fireAt,
    ...text,
    data: { type: 'calendar_reminders', event_id: reminder.eventId, date: reminder.originalDate },
    categoryIdentifier: 'calendar_reminders',
  };
}

// The last tier seen for the household, so reminders stay right offline and while the
// entitlement loads (FR2-REM-6 applies only once a lapse is known).
const tierKey = (householdId: string) => `notifications.premium.${householdId}`;

function lastKnownPremium(householdId: string): boolean {
  try {
    return Storage.getItemSync(tierKey(householdId)) === 'premium';
  } catch {
    return false;
  }
}

function rememberPremium(householdId: string, premium: boolean): void {
  try {
    Storage.setItemSync(tierKey(householdId), premium ? 'premium' : 'free');
  } catch {
    // Only a cache.
  }
}

// Reminders name household events, so they don't outlive the session on this device.
onSignOut(() => setLocalNotifications(EVENT_REMINDER_ID_PREFIX, []));

/**
 * Keeps event reminders (FR2-REM-2) scheduled on this device from the synced calendar: when
 * events, reminders, settings or the tier change, and when the app returns to the foreground.
 * Nothing is scheduled while calendar reminders are off or permission isn't granted.
 */
export function EventReminderScheduler({
  userId,
  membership,
}: {
  userId: string;
  membership: Membership;
}) {
  const { t, i18n } = useTranslation();
  const { householdId } = membership;
  const timeZone = householdTimeZone(membership.timezone);
  const { events, exceptions, reminders, loading } = useCalendarRows();
  const members = useCalendarMembers(householdId);
  const { entitlement, isPremium } = useEntitlement();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (entitlement) rememberPremium(householdId, isPremium);
  }, [entitlement, isPremium, householdId]);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') bump();
    });
    const prefs = onPrefsChanged(bump);
    const details = onEventDetailsChanged(bump);
    return () => {
      appState.remove();
      prefs();
      details();
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    void (async () => {
      const prefs = cachedPrefs(userId);
      const allowed = prefs.calendar_reminders && (await readPushPermission()) === 'granted';
      if (cancelled) return;
      const premium = entitlement ? isPremium : lastKnownPremium(householdId);
      const desired = allowed
        ? eventReminderSchedule({
            events,
            exceptions,
            reminders,
            timeZone,
            weekStart: membership.weekStart,
            now: new Date(),
            premium,
            quietStartMinute: prefs.quietStartMinute,
            quietEndMinute: prefs.quietEndMinute,
          })
        : [];
      const options = {
        t,
        locale: i18n.language,
        timeZone,
        userId,
        members,
        details: showEventDetails(userId),
      };
      await setLocalNotifications(
        EVENT_REMINDER_ID_PREFIX,
        desired.map((r) => eventReminderNotification(r, eventReminderText(r, options))),
      );
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    events,
    exceptions,
    reminders,
    loading,
    members,
    entitlement,
    isPremium,
    householdId,
    timeZone,
    membership.weekStart,
    userId,
    tick,
    t,
    i18n.language,
  ]);

  return null;
}
