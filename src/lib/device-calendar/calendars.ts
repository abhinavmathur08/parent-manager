import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

/**
 * A thin wrapper over `expo-calendar`'s object API for device calendars (C-05, D-14,
 * architecture section 3.5), so feature code and tests deal in plain values. Every call
 * needs the calendar permission (`permission.ts`).
 */

export type DeviceCalendar = { id: string; title: string; account: string };

/** What a copy carries (FR2-DEV-3). Dates are `YYYY-MM-DD` for all-day copies. */
export type CopyDetails =
  | {
      allDay: false;
      title: string;
      location: string | null;
      notes: string;
      url: string;
      /** ISO instants. */
      startsAt: string;
      endsAt: string;
      timeZone: string;
    }
  | {
      allDay: true;
      title: string;
      location: string | null;
      notes: string;
      url: string;
      /** Inclusive dates. */
      startDate: string;
      endDate: string;
    };

/** Calendars the member can write to, for "copy to" (FR2-DEV-2). */
export async function writableCalendars(): Promise<DeviceCalendar[]> {
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return calendars.filter((c) => c.allowsModifications).map(describe);
}

/** Every event calendar, for busy times (FR2-DEV-4). */
export async function eventCalendars(): Promise<DeviceCalendar[]> {
  return (await Calendar.getCalendars(Calendar.EntityTypes.EVENT)).map(describe);
}

function describe(calendar: Calendar.ExpoCalendar): DeviceCalendar {
  return { id: calendar.id, title: calendar.title, account: calendar.source?.name ?? '' };
}

/** Whether a calendar still exists on the device. */
export async function calendarExists(id: string): Promise<boolean> {
  try {
    await Calendar.ExpoCalendar.get(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes our own calendar. On iOS it joins the default calendar's account (iCloud or the
 * phone), or the local one. Android has no default, so it's a local calendar on the phone.
 */
export async function createAppCalendar(title: string, color: string): Promise<string> {
  if (Platform.OS === 'ios') {
    let sourceId: string | undefined;
    try {
      sourceId = Calendar.getDefaultCalendarSync().source?.id;
    } catch {
      sourceId = Calendar.getSourcesSync().find((s) => s.type === Calendar.SourceType.LOCAL)?.id;
    }
    const created = await Calendar.createCalendar({
      title,
      color,
      entityType: Calendar.EntityTypes.EVENT,
      sourceId,
    });
    return created.id;
  }
  const created = await Calendar.createCalendar({
    title,
    color,
    name: title,
    ownerAccount: title,
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
    source: { isLocalAccount: true, name: title, type: Calendar.SourceType.LOCAL },
  });
  return created.id;
}

export async function deleteCalendar(id: string): Promise<void> {
  const calendar = await Calendar.ExpoCalendar.get(id).catch(() => null);
  await calendar?.delete();
}

/** Midnight of a `YYYY-MM-DD` date, in the device's timezone or in UTC. */
function midnight(date: string, utc: boolean, addDays = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  return utc ? new Date(Date.UTC(y, m - 1, d + addDays)) : new Date(y, m - 1, d + addDays);
}

/**
 * The fields written to the device. All-day copies follow each platform's convention:
 * Android stores them at UTC midnight with an exclusive end; EventKit wants local dates with
 * the last day as the end.
 */
export function eventFields(details: CopyDetails) {
  const common = {
    title: details.title,
    location: details.location,
    notes: details.notes,
    ...(Platform.OS === 'ios' ? { url: details.url } : null),
  };
  if (!details.allDay) {
    return {
      ...common,
      allDay: false,
      startDate: new Date(details.startsAt),
      endDate: new Date(details.endsAt),
      timeZone: details.timeZone,
    };
  }
  const android = Platform.OS === 'android';
  return {
    ...common,
    allDay: true,
    startDate: midnight(details.startDate, android),
    endDate: midnight(details.endDate, android, android ? 1 : 0),
    ...(android ? { timeZone: 'UTC' } : null),
  };
}

/**
 * Writes a copy: updates the device event if it's still there, or creates one. Returns the
 * device event's ID.
 */
export async function putEvent(
  calendarId: string,
  existingId: string | null,
  details: CopyDetails,
): Promise<string> {
  const fields = eventFields(details);
  if (existingId) {
    const event = await Calendar.ExpoCalendarEvent.get(existingId).catch(() => null);
    if (event && event.calendarId === calendarId) {
      // A null place clears the copy's location.
      await event.update(fields);
      return existingId;
    }
  }
  const calendar = await Calendar.ExpoCalendar.get(calendarId);
  const created = await calendar.createEvent(fields);
  return created.id;
}

/** Deletes a copy; one already deleted in another calendar app is fine. */
export async function deleteEvent(id: string): Promise<void> {
  const event = await Calendar.ExpoCalendarEvent.get(id).catch(() => null);
  await event?.delete();
}

/**
 * Only what busy times may use from a device event: its ID (to skip our own copies), whether
 * it's all day, and its times (R2-BUSY-3). Titles, places, notes and attendees are dropped
 * here, and never leave this function.
 */
export type DeviceBusyEvent = { id: string; allDay: boolean; startsAt: number; endsAt: number };

/** The events of these calendars that overlap a range, as times only (FR2-DEV-4). */
export async function busyEvents(
  calendarIds: readonly string[],
  from: Date,
  to: Date,
): Promise<DeviceBusyEvent[]> {
  if (calendarIds.length === 0) return [];
  const events = await Calendar.listEvents([...calendarIds], from, to);
  return events
    .filter((event) => event.status !== Calendar.EventStatus.CANCELED)
    .map((event) => ({
      id: event.id,
      allDay: event.allDay,
      startsAt: new Date(event.startDate).getTime(),
      endsAt: new Date(event.endDate).getTime(),
    }));
}
