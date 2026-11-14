import { SECTION_IDS, type AllergenCode, type SectionId } from '@/features/ingredients/catalog-ids';
import { allergenMatches, type AllergenMatch } from '@/features/recipes/scale';
import { UNITS, type QuantityPart, type UnitId, type UnitSystem } from '@/i18n';

import { itemDisplayParts } from './engine';
import type { GroceryItemRow, GroceryItemSourceRow } from './tables';

/**
 * What S-13 shows (FR-LIST-4, FR-LIST-5, R-LIST-6, R-LIST-8): live items grouped by store
 * section in the region's default order, unchecked items alphabetical in the locale, and
 * checked items in the "in the cart" group. Pure, so the order is tested without rendering.
 */

export type ListRowView = {
  id: string;
  name: string;
  /** The quantity in the household's unit system, or the unit a member chose; null if none. */
  quantity: QuantityPart[] | null;
  /** How many planned meals the item is for (the "for 2 meals" hint). */
  meals: number;
  origin: GroceryItemRow['origin'];
  planChanged: boolean;
  checked: boolean;
  sectionId: SectionId;
  allergens: AllergenMatch[];
};

export type ListSectionView = { sectionId: SectionId; rows: ListRowView[] };

export type ListView = {
  sections: ListSectionView[];
  /** Checked items, alphabetical, for the collapsed "in the cart" group. */
  cart: ListRowView[];
  /** All live items. */
  total: number;
};

export type ListViewInput = {
  listId: string;
  items: readonly GroceryItemRow[];
  sources: readonly GroceryItemSourceRow[];
  system: UnitSystem;
  locale: string;
  /** The item's name: a member's custom name, else the ingredient's in the locale. */
  nameOf: (item: GroceryItemRow) => string;
  allergensOf: (ingredientId: string) => readonly AllergenCode[];
  people: readonly { displayName: string; allergies: readonly AllergenCode[] }[];
};

const SECTION_ORDER = new Map<SectionId, number>(SECTION_IDS.map((id, i) => [id, i]));

/** An item's quantity for display (R-UNIT-3 to R-UNIT-5). */
export function itemQuantity(
  item: Pick<GroceryItemRow, 'dimension' | 'quantity_base' | 'display_unit_id'>,
  system: UnitSystem,
): QuantityPart[] | null {
  const unit = item.display_unit_id
    ? (UNITS[item.display_unit_id as UnitId] as (typeof UNITS)[UnitId] | undefined)
    : undefined;
  if (unit && item.quantity_base !== null && unit.dimension === item.dimension) {
    const value = item.quantity_base / unit.toBase;
    const step = unit.fractions ? 0.25 : unit.dimension === 'count' ? 1 : 0.1;
    const rounded = Math.round(value / step) * step;
    return [{ value: rounded > 0 ? rounded : step, unitId: item.display_unit_id as UnitId }];
  }
  return itemDisplayParts(item.dimension, item.quantity_base, system);
}

export function buildListView(input: ListViewInput): ListView {
  const collator = new Intl.Collator(input.locale, { sensitivity: 'base', numeric: true });
  const meals = new Map<string, Set<string>>();
  for (const source of input.sources) {
    if (source.deleted_at) continue;
    let entries = meals.get(source.item_id);
    if (!entries) meals.set(source.item_id, (entries = new Set()));
    entries.add(source.plan_entry_id);
  }

  const rows = input.items
    .filter((item) => item.list_id === input.listId && !item.deleted_at)
    .map((item): ListRowView => ({
      id: item.id,
      name: input.nameOf(item),
      quantity: itemQuantity(item, input.system),
      meals: meals.get(item.id)?.size ?? 0,
      origin: item.origin,
      planChanged: item.user_modified && item.plan_changed,
      checked: item.checked,
      sectionId: SECTION_ORDER.has(item.section_id) ? item.section_id : 'section.other',
      allergens: item.ingredient_id
        ? allergenMatches([item.ingredient_id], input.allergensOf, input.people)
        : [],
    }));
  const byName = (a: ListRowView, b: ListRowView) =>
    collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const sections = new Map<SectionId, ListRowView[]>();
  for (const row of rows) {
    if (row.checked) continue;
    const list = sections.get(row.sectionId);
    if (list) list.push(row);
    else sections.set(row.sectionId, [row]);
  }
  return {
    sections: [...sections.entries()]
      .sort(([a], [b]) => (SECTION_ORDER.get(a) ?? 0) - (SECTION_ORDER.get(b) ?? 0))
      .map(([sectionId, list]) => ({ sectionId, rows: list.sort(byName) })),
    cart: rows.filter((r) => r.checked).sort(byName),
    total: rows.length,
  };
}
