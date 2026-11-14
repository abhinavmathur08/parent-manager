import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

/**
 * The planner tables in the household sync layer (P-01.1, FR-PLAN-11, architecture section 3.2).
 * Plain definitions with no app imports, so the two-device harness can use them too.
 * `sync.ts` registers them with the sync layer.
 */
export const PLAN_ENTRIES = {
  name: 'plan_entries',
  columns: {
    date: 'text',
    slot: 'text',
    position: 'integer',
    recipe_id: 'text',
    free_text: 'text',
    servings: 'real',
    leftover_of_entry_id: 'text',
  },
} as const satisfies SyncTableDefinition;

export const PLAN_ENTRY_PORTIONS = {
  name: 'plan_entry_portions',
  columns: {
    entry_id: 'text',
    person_id: 'text',
    portions: 'real',
    variant: 'text',
  },
} as const satisfies SyncTableDefinition;

export const PLAN_TABLES = [PLAN_ENTRIES, PLAN_ENTRY_PORTIONS] as const;

/** The five slots of a day, in display order (FR-PLAN-1). */
export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] as const;
export type Slot = (typeof SLOTS)[number];

export function isSlot(value: unknown): value is Slot {
  return (SLOTS as readonly unknown[]).includes(value);
}

/** Portions a person can have (FR-PLAN-6). A baby plate is always ¼. */
export const PORTIONS = [0, 0.5, 1, 2] as const;
export type Portion = (typeof PORTIONS)[number];
export const BABY_PLATE_PORTION = 0.25;
export type PortionVariant = 'standard' | 'baby_plate';

/** Limits the database checks too. */
export const PLAN_LIMITS = {
  freeTextLength: 120,
  maxServings: 99,
  /** Servings go in quarter steps, because a baby plate is ¼. */
  servingsStep: 0.25,
} as const;

export type PlanEntryRow = SyncRow & {
  /** A calendar date in the household's timezone, `YYYY-MM-DD`. Never a moment in time. */
  date: string;
  slot: Slot;
  /** Order within the slot. */
  position: number;
  recipe_id: string | null;
  free_text: string | null;
  servings: number;
  leftover_of_entry_id: string | null;
};

export type PlanEntryPortionRow = SyncRow & {
  entry_id: string;
  person_id: string;
  portions: number;
  variant: PortionVariant;
};

/**
 * The ID of a person's portion row on an entry, the same on every device, so two partners
 * setting the same person's portion offline write one row instead of two (the server keeps
 * one row per entry and person). The two IDs are combined byte by byte and stamped as a
 * version 8 UUID (RFC 9562).
 */
export function portionId(entryId: string, personId: string): string {
  const a = entryId.replace(/-/g, '');
  const b = personId.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(a) || !/^[0-9a-f]{32}$/i.test(b)) {
    throw new Error('portionId needs two UUIDs');
  }
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    const x = parseInt(a.slice(i * 2, i * 2 + 2), 16);
    const y = parseInt(b.slice(i * 2, i * 2 + 2), 16);
    // Rotate one side so swapping the two IDs gives a different result.
    bytes.push((x ^ ((y << 3) | (y >> 5))) & 0xff);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
