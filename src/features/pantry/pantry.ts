import { SECTION_IDS, type SectionId } from '@/features/ingredients/catalog-ids';
import type { SaveOp } from '@/features/recipes/draft';
import { stableId } from '@/features/grocery/stable-id';

import { PANTRY_ITEMS, type PantryItemRow } from './tables';

/**
 * The pantry screen's rules (G-03.2, S-22; FR-PAN-2 to FR-PAN-6, R-PAN-1 to R-PAN-3). Pure,
 * so they're tested without a screen.
 */

export type PantryRowView = { rowId: string; ingredientId: string; name: string };
export type PantrySectionView = { sectionId: SectionId; rows: PantryRowView[] };

export type PantryView = {
  /** "Have this week": the ingredients marked "I already have this" for the list week. */
  have: PantryRowView[];
  /** Live staples by store section, in the region's default section order. */
  staples: PantrySectionView[];
};

const SECTION_ORDER = new Map<SectionId, number>(SECTION_IDS.map((id, i) => [id, i]));

/** What S-22 shows: "have this week", then the staples by section, each sorted by name. */
export function pantryView(input: {
  rows: readonly PantryItemRow[];
  weekStart: string;
  nameOf: (ingredientId: string) => string;
  sectionOf: (ingredientId: string) => SectionId;
  locale: string;
}): PantryView {
  const collator = new Intl.Collator(input.locale, { sensitivity: 'base', numeric: true });
  const byName = (a: PantryRowView, b: PantryRowView) =>
    collator.compare(a.name, b.name) || (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0);
  const view = (row: PantryItemRow): PantryRowView => ({
    rowId: row.id,
    ingredientId: row.ingredient_id,
    name: input.nameOf(row.ingredient_id),
  });

  const live = input.rows.filter((r) => !r.deleted_at);
  const have = live
    .filter((r) => r.status === 'have' && r.have_week_start === input.weekStart)
    .map(view)
    .sort(byName);

  const sections = new Map<SectionId, PantryRowView[]>();
  for (const row of live) {
    if (row.status !== 'staple') continue;
    const section = input.sectionOf(row.ingredient_id);
    const id = SECTION_ORDER.has(section) ? section : 'section.other';
    const list = sections.get(id);
    if (list) list.push(view(row));
    else sections.set(id, [view(row)]);
  }
  return {
    have,
    staples: [...sections.entries()]
      .sort(([a], [b]) => (SECTION_ORDER.get(a) ?? 0) - (SECTION_ORDER.get(b) ?? 0))
      .map(([sectionId, rows]) => ({ sectionId, rows: rows.sort(byName) })),
  };
}

/**
 * The ID of a new staple row, the same on every device, so two partners adding the same
 * staple offline write one row. `index` skips IDs this device already used (a tombstone).
 */
export function stapleId(householdId: string, ingredientId: string, index: number): string {
  return stableId('pantry_staple', householdId, ingredientId, String(index));
}

/**
 * Adding a staple (FR-PAN-2): a staple the household turned off comes back on, and any other
 * ingredient gets a new row. An ingredient that's already a staple changes nothing. Returns
 * null for nothing to do, or the write; an insert's ID comes from `stapleId`.
 */
export function planAddStaple(input: {
  ingredientId: string;
  rows: readonly PantryItemRow[];
}): { kind: 'revive'; op: SaveOp } | { kind: 'insert'; values: Record<string, string> } | null {
  const current = input.rows.find(
    (r) =>
      !r.deleted_at &&
      r.ingredient_id === input.ingredientId &&
      (r.status === 'staple' || r.status === 'hidden_staple'),
  );
  if (current?.status === 'staple') return null;
  if (current) {
    return {
      kind: 'revive',
      op: {
        kind: 'update',
        table: PANTRY_ITEMS.name,
        id: current.id,
        values: { status: 'staple' },
      },
    };
  }
  return { kind: 'insert', values: { ingredient_id: input.ingredientId, status: 'staple' } };
}

/**
 * Removing a staple (FR-PAN-2): the row is kept as `hidden_staple` rather than deleted, so a
 * later change to the region's default staples doesn't add it back (R-PAN-1).
 */
export function planRemoveStaple(row: PantryItemRow): SaveOp[] {
  if (row.deleted_at || row.status !== 'staple') return [];
  return [
    { kind: 'update', table: PANTRY_ITEMS.name, id: row.id, values: { status: 'hidden_staple' } },
  ];
}

/**
 * Undoing "have" (FR-PAN-5): the row becomes a tombstone. "I already have this" took the
 * plan item off with `plan_quantity_base` 0, so the list keeper puts it back.
 */
export function planUndoHave(row: PantryItemRow): SaveOp[] {
  if (row.deleted_at || row.status !== 'have') return [];
  return [{ kind: 'remove', table: PANTRY_ITEMS.name, id: row.id }];
}

/**
 * The "assumed at home" row on the list (FR-PAN-3): staples this week's plan needs that the
 * list leaves off, minus any a member already put on the list by hand. Sorted by name.
 */
export function assumedAtHome(input: {
  /** `weekNeeds(...).staples` for the list's week. */
  staples: readonly string[];
  listId: string;
  items: readonly {
    list_id: string;
    ingredient_id: string | null;
    deleted_at: string | null;
  }[];
  nameOf: (ingredientId: string) => string;
  locale: string;
}): { ingredientId: string; name: string }[] {
  const onList = new Set(
    input.items
      .filter((i) => i.list_id === input.listId && !i.deleted_at && i.ingredient_id)
      .map((i) => i.ingredient_id as string),
  );
  const collator = new Intl.Collator(input.locale, { sensitivity: 'base', numeric: true });
  return [...new Set(input.staples)]
    .filter((id) => !onList.has(id))
    .map((ingredientId) => ({ ingredientId, name: input.nameOf(ingredientId) }))
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) ||
        (a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0),
    );
}

/** A local insert that hit an ID this device already holds, such as a tombstone. */
export function isDuplicateRow(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Row already exists');
}

/**
 * Inserts a row whose ID is worked out from its contents (`idFor(0)`, then 1, 2 and so on),
 * skipping IDs this device already holds. Undoing "have" or removing a staple leaves a
 * tombstone under the first ID, and a tombstone never comes back (architecture section 5),
 * so marking the same ingredient again needs the next one.
 */
export async function insertStable(
  writer: { insert(table: string, id: string, values: Record<string, string>): Promise<unknown> },
  table: string,
  idFor: (index: number) => string,
  values: Record<string, string>,
  maxTries = 50,
): Promise<string> {
  for (let index = 0; index < maxTries; index++) {
    const id = idFor(index);
    try {
      await writer.insert(table, id, values);
      return id;
    } catch (error) {
      if (!isDuplicateRow(error)) throw error;
    }
  }
  throw new Error(`No free ID for a new ${table} row`);
}
