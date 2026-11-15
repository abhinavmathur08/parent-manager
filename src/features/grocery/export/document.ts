import type { TFunction } from 'i18next';

import { nameKey, SECTION_IDS, type SectionId } from '@/features/ingredients/catalog-ids';
import { addDays, toDate, type PlanDate } from '@/features/planner/week';
import { formatDate, formatQuantity } from '@/i18n';

import type { ListView, ListRowView } from '../view';

/**
 * The one export formatter (FR-EXP-6, architecture section 7). Print, PDF, text and Apple
 * Reminders all render this document, so every target has the same items, in the same order,
 * with the same quantities as the List tab. Pure: it takes the screen's `ListView`, so the
 * sections, order and quantities match S-13 by construction.
 */

export type ExportItem = {
  /** The grocery item's ID, so targets that keep state (Reminders) can match it again. */
  id: string;
  name: string;
  /** The quantity in the household's units, formatted for the locale; null if none. */
  quantity: string | null;
  /** The whole line, "2 l milk", in the locale's word order. */
  line: string;
  checked: boolean;
};

export type ExportSection = {
  sectionId: SectionId;
  /** The section's name in the locale. Never used for matching or sorting. */
  heading: string;
  items: ExportItem[];
};

export type ExportDocument = {
  /** "Groceries", the list's purpose. */
  title: string;
  /** "Nov 16 – 22" style week dates, formatted by the locale. */
  week: string;
  weekStart: PlanDate;
  sections: ExportSection[];
  itemCount: number;
  includedChecked: boolean;
};

export type ExportInput = {
  view: ListView;
  weekStart: PlanDate;
  /** FR-EXP-1: unchecked items only by default. */
  includeChecked: boolean;
  locale: string;
  t: TFunction;
};

const SECTION_ORDER = new Map<SectionId, number>(SECTION_IDS.map((id, i) => [id, i]));
const WEEK_FORMAT = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;

function exportItem(row: ListRowView, locale: string, t: TFunction): ExportItem {
  const quantity = row.quantity ? formatQuantity(row.quantity, locale) : null;
  return {
    id: row.id,
    name: row.name,
    quantity,
    line: quantity ? t('list.export.line', { quantity, name: row.name }) : row.name,
    checked: row.checked,
  };
}

export function buildExportDocument({
  view,
  weekStart,
  includeChecked,
  locale,
  t,
}: ExportInput): ExportDocument {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const bySection = new Map<SectionId, ListRowView[]>(
    view.sections.map((s) => [s.sectionId, [...s.rows]]),
  );
  if (includeChecked) {
    // Checked items go back under their own section, in the same name order S-13 uses.
    for (const row of view.cart) {
      const rows = bySection.get(row.sectionId);
      if (rows) rows.push(row);
      else bySection.set(row.sectionId, [row]);
    }
    for (const rows of bySection.values()) {
      rows.sort(
        (a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    }
  }

  const sections = [...bySection.entries()]
    .filter(([, rows]) => rows.length > 0)
    .sort(([a], [b]) => (SECTION_ORDER.get(a) ?? 0) - (SECTION_ORDER.get(b) ?? 0))
    .map(([sectionId, rows]) => ({
      sectionId,
      heading: t(nameKey(sectionId)),
      items: rows.map((row) => exportItem(row, locale, t)),
    }));

  return {
    title: t('list.export.listName'),
    week: t('plan.range', {
      start: formatDate(toDate(weekStart), locale, WEEK_FORMAT),
      end: formatDate(toDate(addDays(weekStart, 6)), locale, WEEK_FORMAT),
    }),
    weekStart,
    sections,
    itemCount: sections.reduce((n, s) => n + s.items.length, 0),
    includedChecked: includeChecked,
  };
}
