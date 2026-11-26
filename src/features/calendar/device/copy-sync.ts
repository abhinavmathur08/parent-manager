import Storage from 'expo-sqlite/kv-store';

import { onSignOut } from '@/features/auth/sign-out';
import { onHouseholdAccessLost } from '@/features/household/access-lost';
import * as calendars from '@/lib/device-calendar/calendars';

import { planCopies, type CopyItem, type CopyState } from './copy';
import { clearDeviceSettings, readDeviceSettings, writeDeviceSettings } from './settings';

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

// Runs and removals take turns, so a run never writes copies while they're being removed.
let turn: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = turn.then(work, work);
  turn = result.catch(() => undefined);
  return result;
}

/** Deletes every copy this device made and, if it was ours, the calendar too. */
export function removeCopies(api: CopyApi = calendars): Promise<void> {
  return exclusive(() => removeNow(api));
}

async function removeNow(api: CopyApi): Promise<void> {
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
export function syncCopies(run: CopyRun, api: CopyApi = calendars): Promise<void> {
  return exclusive(() => syncNow(run, api));
}

async function syncNow(run: CopyRun, api: CopyApi): Promise<void> {
  // Turned off (or signing out) while this run waited its turn.
  if (!readDeviceSettings(run.householdId).copy) return;
  let state = readCopyState();
  if (state && state.householdId !== run.householdId) {
    await removeNow(api);
    state = null;
  }
  const { calendarId, own } = await chooseCalendar(run, state, api);
  if (state && state.calendarId !== calendarId) {
    await removeNow(api);
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

/** Whether signing out should ask about copies: only if this device made some. */
export function hasCopies(): boolean {
  return Object.keys(readCopyState()?.copies ?? {}).length > 0;
}

/**
 * Before signing out (FR2-PRIV-4): stops copying and, if the member chose to, removes the
 * copies. Kept by default, since they're in the member's own calendar.
 */
export async function beforeSignOut(remove: boolean, api: CopyApi = calendars): Promise<void> {
  const state = readCopyState();
  if (state) {
    writeDeviceSettings(state.householdId, {
      ...readDeviceSettings(state.householdId),
      copy: false,
    });
  }
  if (remove) await removeCopies(api).catch(() => undefined);
}

/**
 * The member can no longer see the household's events: removed, paused by a lapse, left, or
 * deleting their account (R2-ACC-2, D-16, SR2-M2). Turns copying and busy times off on this
 * device, so a run still waiting its turn writes nothing, then removes every copy, from a
 * picked calendar too. Unlike sign-out (FR2-PRIV-4), the member isn't asked.
 */
export async function removeCopiesAfterAccessLost(api: CopyApi = calendars): Promise<void> {
  clearDeviceSettings();
  await removeCopies(api).catch(() => undefined);
}

onHouseholdAccessLost(() => removeCopiesAfterAccessLost());
