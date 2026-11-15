import { addDays, type PlanDate } from '@/features/planner/week';
import type { PlanEntryRow } from '@/features/planner/tables';
import { hasTag, NEEDS_DEFROSTING_TAG, type RecipeRow } from '@/features/recipes/tables';

/** FR-NOT-5 (PROPOSED): the reminder goes at 08:00 on the day of the dinner. */
export const DEFROST_MINUTE = 8 * 60;

/** How far ahead reminders are scheduled; the schedule is refreshed as the plan changes. */
export const DEFROST_DAYS_AHEAD = 14;

/** Local notification IDs start with this, so the app can find and replace its own. */
export const DEFROST_ID_PREFIX = 'defrost.';

export type DefrostReminder = {
  /** The local notification's identifier: one per plan entry. */
  id: string;
  entryId: string;
  date: PlanDate;
  /** When it goes, in the device's local time (spec AS-7). */
  fireAt: Date;
  /** The recipe's title: the notification names the meal (spec 3.11 acceptance). */
  meal: string;
};

/** Local midnight plus `minute`, for a `YYYY-MM-DD` date. */
function localTime(date: PlanDate, minute: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minute / 60), minute % 60);
}

/**
 * When a reminder due at `minute` may go: then, or the end of quiet hours if it falls inside
 * them (FR-NOT-6: local notifications are scheduled outside quiet hours). Equal start and
 * end means no quiet hours.
 */
export function outsideQuietHours(minute: number, quietStart: number, quietEnd: number): number {
  if (quietStart === quietEnd) return minute;
  const quiet =
    quietStart < quietEnd
      ? minute >= quietStart && minute < quietEnd
      : minute >= quietStart || minute < quietEnd;
  // A window across midnight ends the same morning; one within the day ends later that day.
  return quiet ? quietEnd : minute;
}

/**
 * The "defrost tonight" reminders this device should have (FR-NOT-5): one for each live
 * dinner from today on, up to two weeks ahead, whose recipe has the needs-defrosting tag (R-02.3's `tag.needs_defrosting`, matched by ID),
 * at 08:00 or after quiet hours, and still in the future. Moving or removing the entry, or
 * untagging the recipe, drops or moves its reminder.
 */
export function defrostSchedule({
  entries,
  recipes,
  today,
  now,
  quietStartMinute,
  quietEndMinute,
}: {
  entries: readonly PlanEntryRow[];
  recipes: readonly RecipeRow[];
  today: PlanDate;
  now: Date;
  quietStartMinute: number;
  quietEndMinute: number;
}): DefrostReminder[] {
  const last = addDays(today, DEFROST_DAYS_AHEAD - 1);
  const tagged = new Map(
    recipes
      .filter((r) => !r.deleted_at && hasTag(r, NEEDS_DEFROSTING_TAG))
      .map((r) => [r.id, r.title]),
  );
  const minute = outsideQuietHours(DEFROST_MINUTE, quietStartMinute, quietEndMinute);
  return entries
    .filter(
      (e) =>
        !e.deleted_at &&
        e.slot === 'dinner' &&
        e.recipe_id !== null &&
        tagged.has(e.recipe_id) &&
        e.date >= today &&
        e.date <= last,
    )
    .map((e) => ({
      id: `${DEFROST_ID_PREFIX}${e.id}`,
      entryId: e.id,
      date: e.date,
      fireAt: localTime(e.date, minute),
      meal: tagged.get(e.recipe_id!)!,
    }))
    .filter((r) => r.fireAt.getTime() > now.getTime())
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}
