import { randomUUID } from 'expo-crypto';
import Storage from 'expo-sqlite/kv-store';

import { onSignOut } from '@/features/auth/sign-out';
import { onHouseholdAccessLost } from '@/features/household/access-lost';
import { busyEvents } from '@/lib/device-calendar/calendars';
import { getSupabase } from '@/lib/supabase';
import type { SyncValue } from '@/lib/sync/types';

import { BUSY_BLOCKS, type BusyBlockRow } from '../tables';
import { busyBlocks, planBlocks, type BusyTimesConfig } from './busy-times';
import { readCopyState } from './copy-sync';

/** The sync layer's writes, so blocks show at once and sync when online (H-06.3). */
export type BlockWriter = {
  insert: (table: string, id: string, values: Record<string, SyncValue>) => Promise<unknown>;
  remove: (table: string, id: string) => Promise<unknown>;
};

const REFRESHED_KEY = 'calendar.device.busy.refreshed';
type Refreshed = { householdId: string; calendars: string; at: number };

function readRefreshed(): Refreshed | null {
  try {
    const raw = Storage.getItemSync(REFRESHED_KEY);
    return raw ? (JSON.parse(raw) as Refreshed) : null;
  } catch {
    return null;
  }
}

function writeRefreshed(value: Refreshed | null) {
  try {
    if (value) Storage.setItemSync(REFRESHED_KEY, JSON.stringify(value));
    else Storage.removeItemSync(REFRESHED_KEY);
  } catch {
    // The next open refreshes again.
  }
}

export type BusyRefresh = {
  householdId: string;
  userId: string;
  calendarIds: readonly string[];
  /** The member's own blocks in the local copy. */
  mine: readonly BusyBlockRow[];
  writer: BlockWriter;
  config: BusyTimesConfig;
  now: number;
};

/**
 * Replaces the member's busy blocks with the chosen calendars' timed events for the next
 * days (FR2-DEV-4), at most once per refresh interval unless the calendars changed
 * (FR2-DEV-5). Device events are read in memory and only start and end times reach the
 * writer (R2-BUSY-3). Returns whether it ran.
 */
export async function refreshBusyTimes(
  run: BusyRefresh,
  read: typeof busyEvents = busyEvents,
): Promise<boolean> {
  const copies = readCopyState();
  // Never our own copies: not their calendar, and not their events in a calendar we share.
  const calendarIds = run.calendarIds.filter((id) => !(copies?.own && copies.calendarId === id));
  const calendars = [...calendarIds].sort().join(',');
  const last = readRefreshed();
  if (
    last &&
    last.householdId === run.householdId &&
    last.calendars === calendars &&
    run.now - last.at < run.config.refreshMinutes * 60_000 &&
    run.now >= last.at
  ) {
    return false;
  }

  const from = run.now;
  const to = run.now + run.config.windowDays * 24 * 60 * 60 * 1000;
  const skipIds = new Set(Object.values(copies?.copies ?? {}).map((copy) => copy.id));
  const wanted = busyBlocks(await read(calendarIds, new Date(from), new Date(to)), {
    from,
    to,
    skipIds,
  });
  // Past blocks are left alone; only the window is replaced.
  const mine = run.mine.filter((row) => Date.parse(row.ends_at) > from);
  const plan = planBlocks(wanted, mine);
  for (const id of plan.remove) await run.writer.remove(BUSY_BLOCKS.name, id);
  for (const block of plan.insert) {
    await run.writer.insert(BUSY_BLOCKS.name, randomUUID(), {
      user_id: run.userId,
      starts_at: block.starts_at,
      ends_at: block.ends_at,
    });
  }
  writeRefreshed({ householdId: run.householdId, calendars, at: run.now });
  return true;
}

/**
 * Deletes the member's busy blocks from the server at once (FR2-DEV-5): one update of the
 * caller's live rows, which RLS keeps to their own. Returns false when offline.
 */
export async function deleteMyBlocksOnServer(householdId?: string): Promise<boolean> {
  let query = getSupabase()
    .from(BUSY_BLOCKS.name)
    .update({ deleted_at: new Date().toISOString() })
    .is('deleted_at', null);
  if (householdId) query = query.eq('household_id', householdId);
  const { error } = await query;
  return !error;
}

/**
 * Turning busy times off (FR2-DEV-5): deleted on the server at once when online, and through
 * the sync layer too, so the local copy agrees and an offline device deletes them when it's
 * back (a late delete of a row already deleted is harmless).
 */
export async function stopBusyTimes(
  householdId: string,
  mine: readonly BusyBlockRow[],
  writer: BlockWriter,
): Promise<void> {
  writeRefreshed(null);
  await deleteMyBlocksOnServer(householdId).catch(() => false);
  for (const row of mine) {
    if (!row.deleted_at) await writer.remove(BUSY_BLOCKS.name, row.id);
  }
}

// Losing access stops busy times too (SR2-M2): the server already deleted this member's
// blocks when their membership ended, and RLS no longer lets them write, so only forget here.
onHouseholdAccessLost(() => writeRefreshed(null));

// Signing out always stops busy times (FR2-PRIV-4), while the session can still reach the
// server. The refresh record shows this device shared some; settings are cleared separately.
onSignOut(async () => {
  const shared = readRefreshed();
  writeRefreshed(null);
  if (shared) await deleteMyBlocksOnServer(shared.householdId).catch(() => false);
});
