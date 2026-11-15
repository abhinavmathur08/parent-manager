import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { track } from '@/lib/analytics';
import { getSupabase } from '@/lib/supabase';
import { createZip, type ZipEntry } from '@/lib/zip';

/**
 * Data export (A-04.2, FR-PRIV-2, FR-MEM-4, FR-PAY-10): the server builds the export from its
 * registry (migration 20261116130000_data_export.sql), so every registered table is in it,
 * and this turns it into a ZIP with a JSON file per data type and CSV files for recipes,
 * plans and lists, then opens the share sheet. Always free; needs a connection (NFR-OFF-2).
 */

export type ExportScope = 'household' | 'account';

type Row = Record<string, unknown>;

export type ExportData = {
  format: string;
  version: number;
  scope: ExportScope;
  exported_at: string;
  tables: Record<string, Row[]>;
};

/** Reads the export from the server: the household (parents only) or the caller's account. */
export async function fetchExport(scope: ExportScope, householdId: string): Promise<ExportData> {
  const supabase = getSupabase();
  const { data, error } =
    scope === 'household'
      ? await supabase.rpc('export_household_data', { target: householdId })
      : await supabase.rpc('export_account_data');
  if (error) throw error;
  return data as ExportData;
}

/** One CSV field (RFC 4180): quoted when it holds a comma, quote or line break. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A CSV file from rows. Headers are the stored column names: CSV is for other software, so it
 * keeps the same language-neutral identifiers as the JSON (ingredient IDs, unit IDs, codes).
 */
export function toCsv(columns: readonly string[], rows: readonly Row[]): string {
  const lines = [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => csvField(r[c])).join(',')),
  ];
  return lines.join('\r\n') + '\r\n';
}

const byKeys =
  (...keys: string[]) =>
  (a: Row, b: Row) => {
    for (const key of keys) {
      const x = String(a[key] ?? '');
      const y = String(b[key] ?? '');
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };

/** The CSV files (FR-PRIV-2): recipes, the plan, and grocery lists with their week. */
export function exportCsvFiles(tables: Record<string, Row[]>): Record<string, string> {
  const files: Record<string, string> = {};
  if (tables.recipes) {
    files['recipes.csv'] = toCsv(
      [
        'id',
        'title',
        'servings',
        'prep_minutes',
        'cook_minutes',
        'tags',
        'source_url',
        'notes',
        'created_at',
      ],
      [...tables.recipes].sort(byKeys('title', 'id')),
    );
  }
  if (tables.plan_entries) {
    const titles = new Map((tables.recipes ?? []).map((r) => [r.id, r.title]));
    files['plans.csv'] = toCsv(
      ['date', 'slot', 'position', 'recipe_id', 'recipe_title', 'free_text', 'servings'],
      [...tables.plan_entries]
        .map((e) => ({ ...e, recipe_title: e.recipe_id ? (titles.get(e.recipe_id) ?? '') : '' }))
        .sort(byKeys('date', 'slot', 'position')),
    );
  }
  if (tables.grocery_items) {
    const weeks = new Map((tables.grocery_lists ?? []).map((l) => [l.id, l.week_start]));
    files['grocery_lists.csv'] = toCsv(
      [
        'week_start',
        'ingredient_id',
        'custom_name',
        'quantity_base',
        'dimension',
        'section_id',
        'origin',
        'checked',
        'checked_at',
        'shopped_at',
      ],
      [...tables.grocery_items]
        .map((i) => ({ ...i, week_start: weeks.get(i.list_id) ?? '' }))
        .sort(byKeys('week_start', 'section_id', 'ingredient_id', 'custom_name', 'id')),
    );
  }
  return files;
}

/** The ZIP's entries: a JSON file per data type, the CSV files and a manifest. */
export function exportEntries(data: ExportData): ZipEntry[] {
  const encoder = new TextEncoder();
  const text = (name: string, value: string): ZipEntry => ({
    name,
    data: encoder.encode(value),
  });
  const tables = Object.keys(data.tables).sort();
  return [
    text(
      'manifest.json',
      JSON.stringify(
        {
          format: data.format,
          version: data.version,
          scope: data.scope,
          exported_at: data.exported_at,
          files: tables.map((t) => `${t}.json`),
        },
        null,
        2,
      ),
    ),
    ...tables.map((t) => text(`${t}.json`, JSON.stringify(data.tables[t], null, 2))),
    ...Object.entries(exportCsvFiles(data.tables)).map(([name, csv]) => text(name, csv)),
  ];
}

/** A coarse size, for analytics only (spec 3.12: `size_bucket`). */
export function sizeBucket(bytes: number): string {
  if (bytes < 100_000) return 'under_100kb';
  if (bytes < 1_000_000) return 'under_1mb';
  if (bytes < 10_000_000) return 'under_10mb';
  return 'over_10mb';
}

/**
 * Exports and opens the share sheet. The file goes in the app's cache, which the system may
 * clear; it holds the household's data, so it isn't kept anywhere else.
 */
export async function shareExport(input: {
  scope: ExportScope;
  householdId: string;
  dialogTitle: string;
  now?: Date;
}): Promise<void> {
  track('data_export_requested', { scope: input.scope });
  const data = await fetchExport(input.scope, input.householdId);
  const now = input.now ?? new Date();
  const zip = createZip(exportEntries(data), now);
  const day = now.toISOString().slice(0, 10);
  const file = new File(Paths.cache, `parent-manager-${input.scope}-${day}.zip`);
  if (file.exists) file.delete();
  file.create();
  await file.write(zip);
  track('data_export_completed', { scope: input.scope, size_bucket: sizeBucket(zip.length) });
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
    dialogTitle: input.dialogTitle,
  });
}
