import Storage from 'expo-sqlite/kv-store';

import { onSignOut } from '@/features/auth/sign-out';
import * as calendars from '@/lib/device-calendar/calendars';

import { planCopies, type CopyItem, type CopyState } from './copy';

/** The device calendar calls the copy needs, replaceable in tests. */
export type CopyApi = Pick<
  typeof calendars,
  'calendarExists' | 'createAppCalendar' | 'deleteCalendar' | 'putEvent' | 'deleteEvent'
>;

const KEY = 'calendar.device.copies';

/** Which device events are our copies, so updates and deletions find them (architecture 3.5). */
export function readCopyState(): CopyState | null {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? (JSON.parse(raw) as CopyState) : null;
  } catch {
    return null;
  }
}

export function writeCopyState(state: CopyState | null): void {
  try {
    if (state) Storage.setItemSync(KEY, JSON.stringify(state));
    else Storage.removeItemSync(KEY);
  } catch {
    // Without storage the next run makes the copies again.
  }
}

// Signing out keeps the copies unless the member chose to remove them first (FR2-PRIV-4);
// either way this device stops tracking them.
onSignOut(() => writeCopyState(null));

export type CopyRun = {
  householdId: string;
  /** A writable device calendar the member picked, or null for our own. */
  target: string | null;
  items: readonly CopyItem[];
  /** Our calendar's name and color, if it has to be made. */
  calendarTitle: string;
  calendarColor: string;
};

/** Deletes every copy this device made and, if it was ours, the calendar too. */
export async function removeCopies(api: CopyApi = calendars): Promise<void> {
  const state = readCopyState();
  if (!state) return;
  if (state.own) {
    await api.deleteCalendar(state.calendarId).catch(() => undefined);
  } else {
    for (const copy of Object.values(state.copies)) {
      await api.deleteEvent(copy.id).catch(() => undefined);
    }
  }
  writeCopyState(null);
}

async function chooseCalendar(run: CopyRun, state: CopyState | null, api: CopyApi) {
  if (run.target && (await api.calendarExists(run.target))) {
    return { calendarId: run.target, own: false };
  }
  // The picked calendar is gone, or none was picked: our own, made once and reused.
  if (state?.own && (await api.calendarExists(state.calendarId))) {
    return { calendarId: state.calendarId, own: true };
  }
  return {
    calendarId: await api.createAppCalendar(run.calendarTitle, run.calendarColor),
    own: true,
  };
}

/**
 * Brings the device copies up to date (FR2-DEV-2): creates, updates and deletes only what
 * changed since the last run. Moving to another calendar or household removes the old copies
 * first. A copy that fails is tried again on the next run.
 */
export async function syncCopies(run: CopyRun, api: CopyApi = calendars): Promise<void> {
  let state = readCopyState();
  if (state && state.householdId !== run.householdId) {
    await removeCopies(api);
    state = null;
  }
  const { calendarId, own } = await chooseCalendar(run, state, api);
  if (state && state.calendarId !== calendarId) {
    await removeCopies(api);
    state = null;
  }
  const copies = { ...(state?.copies ?? {}) };
  const save = () => writeCopyState({ householdId: run.householdId, calendarId, own, copies });
  save();

  const plan = planCopies(run.items, copies);
  for (const change of plan.remove) {
    try {
      await api.deleteEvent(change.id);
      delete copies[change.key];
    } catch {
      // Kept, and deleted on a later run.
    }
  }
  for (const change of plan.put) {
    try {
      const id = await api.putEvent(calendarId, change.existingId, change.details);
      copies[change.key] = { id, hash: change.hash };
    } catch {
      // Written on a later run.
    }
  }
  save();
}
