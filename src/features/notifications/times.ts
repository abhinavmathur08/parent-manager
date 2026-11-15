import { formatDate } from '@/i18n';

/** A time of day given as minutes after midnight, in the locale's clock ("6:00 PM", "18:00"). */
export function formatMinute(minute: number, locale: string): string {
  const date = new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60));
  return formatDate(date, locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

/** The name of an ISO weekday (1 Monday to 7 Sunday) in the locale. */
export function formatWeekday(isoDay: number, locale: string): string {
  // 1 January 2024 was a Monday.
  return formatDate(new Date(Date.UTC(2024, 0, isoDay)), locale, {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

/** Every hour of the day, as minutes after midnight. */
export const HOURS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour * 60);

/** ISO weekdays, Monday first. */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
