import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { theme } from '@/constants/theme';
import { useAuth } from '@/features/auth/session';
import { usePlanRows } from '@/features/planner/data';
import type { PlanEntryRow } from '@/features/planner/tables';
import { todayIn } from '@/features/planner/week';
import { useRecipeRows } from '@/features/recipes/data';
import type { Membership } from '@/features/household/membership';
import { formatList } from '@/i18n';
import { reportError } from '@/lib/crash-reporting';
import { readCalendarAccess } from '@/lib/device-calendar/permission';
import { useSyncEngine, useSyncStatus } from '@/lib/sync';

import { householdTimeZone } from '../agenda';
import { kindKey } from '../agenda-screen';
import { useCalendarRows } from '../data';
import type { EventRow } from '../tables';
import { BusyTimesSync } from './busy-times-sync';
import { copyItems, dinnersByDate } from './copy';
import { syncCopies } from './copy-sync';
import { useDeviceSettings } from './settings';

/** How long to wait for a burst of changes (a pull, a repeat edited) to settle. */
const SETTLE_MS = 1000;

/**
 * Keeps "Copy to my calendar" (C-05.2, FR2-DEV-2) and "Share my busy times" (C-05.3,
 * FR2-DEV-4) up to date. Copies are written on start, when the app returns
 * to the foreground, and when the synced events (or dinners, with meals on) change. It waits
 * for the local copy to finish loading, so it never removes copies of events still arriving.
 * Mounted once with the tabs; renders nothing.
 */
export function DeviceCalendarSync({ membership }: { membership: Membership }) {
  const [settings] = useDeviceSettings(membership.householdId);
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  return (
    <>
      {settings.copy ? (
        <Copier
          membership={membership}
          target={settings.copyTarget}
          includeMeals={settings.includeMeals}
        />
      ) : null}
      {settings.busy && userId ? (
        <BusyTimesSync
          householdId={membership.householdId}
          userId={userId}
          calendarIds={settings.busyCalendars}
        />
      ) : null}
    </>
  );
}

function Copier({
  membership,
  target,
  includeMeals,
}: {
  membership: Membership;
  target: string | null;
  includeMeals: boolean;
}) {
  const { t, i18n } = useTranslation();
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const { events, exceptions, loading } = useCalendarRows();
  const plan = usePlanRows();
  const { recipes } = useRecipeRows();
  const timeZone = householdTimeZone(membership.timezone);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);

  const ready =
    engine !== null &&
    !loading &&
    !status.firstLoad &&
    (status.state === 'idle' || status.state === 'offline');

  const items = useMemo(() => {
    if (!ready) return null;
    const titles = new Map(recipes.filter((r) => !r.deleted_at).map((r) => [r.id, r.title]));
    const titleOf = (entry: PlanEntryRow) =>
      (entry.recipe_id ? titles.get(entry.recipe_id) : undefined) ??
      entry.free_text ??
      t('plan.deletedRecipe');
    return copyItems({
      events,
      exceptions,
      timeZone,
      weekStart: membership.weekStart,
      today: todayIn(timeZone, new Date(now)),
      kindName: (kind) => t(kindKey(kind as EventRow['kind'])),
      eventLink: (id, date) => Linking.createURL(`calendar/${id}`, { queryParams: { date } }),
      dinners: includeMeals ? dinnersByDate(plan.entries, titleOf) : null,
      mealTitle: (names) =>
        t('calendarSettings.copy.mealTitle', { meals: formatList(names, i18n.language) }),
      mealNotes: t('calendarSettings.copy.mealNotes'),
      mealLink: () => Linking.createURL('plan'),
    });
  }, [
    ready,
    events,
    exceptions,
    plan.entries,
    recipes,
    includeMeals,
    timeZone,
    membership,
    now,
    t,
    i18n.language,
  ]);

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!items) return;
    const timer = setTimeout(() => {
      queue.current = queue.current
        .then(async () => {
          // Taken away in the system's Settings: paused until it's given back.
          if ((await readCalendarAccess()) !== 'granted') return;
          await syncCopies({
            householdId: membership.householdId,
            target,
            items,
            calendarTitle: t('calendarSettings.copy.calendarName'),
            calendarColor: theme.light.color.primary,
          });
        })
        .catch(reportError);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [items, target, membership.householdId, t]);

  return null;
}
