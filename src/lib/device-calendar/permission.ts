import * as Calendar from 'expo-calendar';

/**
 * The phone's calendar permission (C-05.1, FR2-DEV-1, NFR2-SEC-5). Full access on iOS: the
 * write-only access of iOS 17+ can't create our calendar, update copies or read busy times
 * (architecture section 3.5).
 *
 * - `granted`: device features can run.
 * - `undetermined`: never asked, or Android can ask again.
 * - `blocked`: refused, and only the system's Settings app can change it.
 */
export type CalendarAccess = 'granted' | 'undetermined' | 'blocked';

function access(response: { granted: boolean; canAskAgain: boolean }): CalendarAccess {
  if (response.granted) return 'granted';
  return response.canAskAgain ? 'undetermined' : 'blocked';
}

/** Reads the permission without asking. */
export async function readCalendarAccess(): Promise<CalendarAccess> {
  return access(await Calendar.getCalendarPermissions());
}

/** Asks the system. Only call this after the member turns a device feature on. */
export async function requestCalendarAccess(): Promise<CalendarAccess> {
  return access(await Calendar.requestCalendarPermissions());
}
