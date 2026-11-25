import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { onSignOut } from '@/features/auth/sign-out';
import { downloadPages, readLinks } from '@/features/documents/read';
import { UploadError } from '@/features/documents/upload';
import { track } from '@/lib/analytics';
import { getSupabase } from '@/lib/supabase';
import { ZipWriter, type ZipEntry } from '@/lib/zip';

/**
 * Data export (A-04.2, FR-PRIV-2, FR-MEM-4, FR-PAY-10): the server builds the export from its
 * registry (migration 20261116130000_data_export.sql), so every registered table is in it,
 * and this turns it into a ZIP with a JSON file per data type and CSV files for recipes,
 * plans and lists, then opens the share sheet. Always free; needs a connection (NFR-OFF-2).
 *
 * A household export also holds each document's files in `documents/<document_id>/`
 * (FR2-PRIV-1, A-05). They come through the documents function's 60-second read links, the
 * only way to read them (D-22), one document at a time, and the ZIP is written straight to a
 * file, so a large vault never has to fit in memory. The ZIP and the downloaded files are
 * deleted once the share sheet closes, and on sign-out (FR2-DOC-4).
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

/** What went into the ZIP's `documents/` folder. */
export type DocumentFiles = {
  /** The paths written, such as `documents/<document_id>/1.jpg`. */
  files: string[];
  /** Documents deleted while the export ran, so they have no files in it. */
  missing: string[];
};

/** The manifest: what the export covers and the files in it. */
export function manifestEntry(
  data: ExportData,
  documents: DocumentFiles = { files: [], missing: [] },
): ZipEntry {
  const tables = Object.keys(data.tables).sort();
  const manifest = {
    format: data.format,
    version: data.version,
    scope: data.scope,
    exported_at: data.exported_at,
    files: tables.map((t) => `${t}.json`),
    ...(data.tables.documents
      ? { document_files: documents.files, documents_without_files: documents.missing }
      : {}),
  };
  return {
    name: 'manifest.json',
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  };
}

/** A JSON file per data type and the CSV files. */
export function dataEntries(data: ExportData): ZipEntry[] {
  const encoder = new TextEncoder();
  const text = (name: string, value: string): ZipEntry => ({
    name,
    data: encoder.encode(value),
  });
  return [
    ...Object.keys(data.tables)
      .sort()
      .map((t) => text(`${t}.json`, JSON.stringify(data.tables[t], null, 2))),
    ...Object.entries(exportCsvFiles(data.tables)).map(([name, csv]) => text(name, csv)),
  ];
}

/** The ZIP's entries without document files: a manifest, a JSON file per data type and the CSVs. */
export function exportEntries(data: ExportData): ZipEntry[] {
  return [manifestEntry(data), ...dataEntries(data)];
}

/**
 * The documents whose files go in the export: those that finished uploading. A document still
 * uploading is never shown to anyone and has no complete files (architecture 3.5).
 */
export function documentsWithFiles(tables: Record<string, Row[]>): string[] {
  return (tables.documents ?? [])
    .filter((d) => d.status === 'ready' && typeof d.id === 'string')
    .map((d) => d.id as string)
    .sort();
}

/**
 * Adds each document's files to the ZIP as `documents/<document_id>/<page>.<ext>`. Each
 * document gets fresh read links, its files are downloaded to `folder`, added one at a time
 * and deleted. A document deleted meanwhile is listed as missing; any other failure stops the
 * export, so it never looks complete when it isn't.
 */
export async function addDocumentFiles(
  zip: ZipWriter,
  documentIds: readonly string[],
  folder: Directory,
): Promise<DocumentFiles> {
  const result: DocumentFiles = { files: [], missing: [] };
  for (const id of documentIds) {
    let read;
    try {
      read = await readLinks(id);
    } catch (error) {
      if (error instanceof UploadError && error.code === 'documents.not_found') {
        result.missing.push(id);
        continue;
      }
      throw error;
    }
    const uris = await downloadPages(read.links, folder, read.mime);
    for (const uri of uris) {
      const file = new File(uri);
      const name = `documents/${id}/${file.name}`;
      await zip.add(name, await file.bytes());
      file.delete();
      result.files.push(name);
    }
  }
  return result;
}

/** A coarse size, for analytics only (spec 3.12: `size_bucket`). */
export function sizeBucket(bytes: number): string {
  if (bytes < 100_000) return 'under_100kb';
  if (bytes < 1_000_000) return 'under_1mb';
  if (bytes < 10_000_000) return 'under_10mb';
  return 'over_10mb';
}

const EXPORT_FOLDER = 'data-export';

function exportFolder(): Directory {
  return new Directory(Paths.cache, EXPORT_FOLDER);
}

/** Removes every export and downloaded file this device still holds. */
export function clearExports(): void {
  try {
    const folder = exportFolder();
    if (folder.exists) folder.delete();
  } catch {
    // Already gone, or the cache was cleared by the system.
  }
}

/**
 * Exports and opens the share sheet. The ZIP is written to the app's cache and deleted when the
 * share sheet closes: it holds the household's data and documents, so it isn't kept.
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
  const day = now.toISOString().slice(0, 10);

  clearExports();
  const folder = exportFolder();
  folder.create({ intermediates: true, idempotent: true });
  const downloads = new Directory(folder, 'files');
  downloads.create({ intermediates: true, idempotent: true });
  const file = new File(folder, `parent-manager-${input.scope}-${day}.zip`);
  try {
    file.create();
    const handle = file.open(FileMode.WriteOnly);
    let size: number;
    try {
      const zip = new ZipWriter((bytes) => handle.writeBytes(bytes), now);
      for (const entry of dataEntries(data)) await zip.add(entry.name, entry.data);
      const documents = await addDocumentFiles(zip, documentsWithFiles(data.tables), downloads);
      const manifest = manifestEntry(data, documents);
      await zip.add(manifest.name, manifest.data);
      await zip.finish();
      size = zip.size;
    } finally {
      handle.close();
    }
    downloads.delete();
    track('data_export_completed', { scope: input.scope, size_bucket: sizeBucket(size) });
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
      dialogTitle: input.dialogTitle,
    });
  } finally {
    clearExports();
  }
}

onSignOut(clearExports);
