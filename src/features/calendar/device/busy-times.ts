/**
 * "Share my busy times" (C-05.3, FR2-DEV-4, FR2-DEV-5, R2-BUSY-3): device events become busy
 * blocks of a start and an end, nothing else. Pure, so it's tested without a phone.
 */
import type { DeviceBusyEvent } from '@/lib/device-calendar/calendars';

import type { BusyBlockRow } from '../tables';

export type BusyTimesConfig = { windowDays: number; refreshMinutes: number };

/** `app_config` `calendar.busy_times` (R2-PAY-1); these values when offline or unset. */
export const BUSY_TIMES_KEY = 'calendar.busy_times';
export const DEFAULT_BUSY_TIMES: BusyTimesConfig = { windowDays: 14, refreshMinutes: 15 };

export function parseBusyTimes(value: unknown): BusyTimesConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const whole = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  return {
    windowDays: whole(raw.window_days, 1, 60, DEFAULT_BUSY_TIMES.windowDays),
    refreshMinutes: whole(raw.refresh_minutes, 1, 24 * 60, DEFAULT_BUSY_TIMES.refreshMinutes),
  };
}

/** A block as written: ISO instants only. */
export type Block = { starts_at: string; ends_at: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The member's busy blocks for [from, to): timed events only (all-day events never count,
 * R2-BUSY-1), not our own copies, clipped to the window, overlaps merged, and long events cut
 * into pieces of at most a day (the table's limit).
 */
export function busyBlocks(
  events: readonly DeviceBusyEvent[],
  { from, to, skipIds }: { from: number; to: number; skipIds: ReadonlySet<string> },
): Block[] {
  const spans = events
    .filter((e) => !e.allDay && !skipIds.has(e.id))
    .map((e) => [Math.max(e.startsAt, from), Math.min(e.endsAt, to)] as const)
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const blocks: Block[] = [];
  for (const [start, end] of merged) {
    for (let at = start; at < end; at += DAY_MS) {
      blocks.push({
        starts_at: new Date(at).toISOString(),
        ends_at: new Date(Math.min(at + DAY_MS, end)).toISOString(),
      });
    }
  }
  return blocks;
}

const span = (b: { starts_at: string; ends_at: string }) =>
  `${Date.parse(b.starts_at)}-${Date.parse(b.ends_at)}`;

/** The member's blocks to add and remove so the server matches what the device has now. */
export function planBlocks(
  wanted: readonly Block[],
  mine: readonly BusyBlockRow[],
): { insert: Block[]; remove: string[] } {
  const have = new Map<string, string>();
  const remove: string[] = [];
  for (const row of mine) {
    if (row.deleted_at) continue;
    const key = span(row);
    // A duplicate (two devices of one member) goes.
    if (have.has(key)) remove.push(row.id);
    else have.set(key, row.id);
  }
  const insert: Block[] = [];
  const keep = new Set<string>();
  for (const block of wanted) {
    const key = span(block);
    if (have.has(key)) keep.add(key);
    else insert.push(block);
  }
  for (const [key, id] of have) if (!keep.has(key)) remove.push(id);
  return { insert, remove };
}
