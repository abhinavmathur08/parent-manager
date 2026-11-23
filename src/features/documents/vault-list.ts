import { useMemo } from 'react';

import type { PlanDate } from '@/features/planner/week';
import { useSyncedRows } from '@/lib/sync';

import { DOCUMENT_CATEGORIES, DOCUMENTS, type DocumentCategory, type DocumentRow } from './tables';

/**
 * The household's documents from the local copy, so the vault lists offline (FR2-DOC-1,
 * NFR2-OFF-1). Only rows the member may see reach the copy (C-01.3), and only `ready` ones,
 * since the server hides uploads in progress. Tombstones are left out.
 */
export function useDocuments(): { documents: DocumentRow[]; loading: boolean } {
  const { rows, loading } = useSyncedRows<DocumentRow>(DOCUMENTS.name);
  const documents = useMemo(
    () => rows.filter((row) => !row.deleted_at && row.status === 'ready'),
    [rows],
  );
  return { documents, loading };
}

export type VaultSection = { category: DocumentCategory; documents: DocumentRow[] };

/**
 * Documents grouped by category, in the categories' fixed order, never by their translated
 * names (NFR2-L10N-1). Within a category, titles in the locale's order.
 */
export function vaultSections(documents: readonly DocumentRow[], locale: string): VaultSection[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return DOCUMENT_CATEGORIES.map((category) => ({
    category,
    documents: documents
      .filter((doc) => doc.category === category)
      .sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id)),
  })).filter((section) => section.documents.length > 0);
}

/** The translation key for a category's name: `doc.medical` is `documents.category.medical`. */
export function categoryKey(category: DocumentCategory): string {
  return `documents.category.${category.slice('doc.'.length)}`;
}

/** Whether a document's expiry date has passed, in the household's day. */
export function isExpired(expiresOn: string | null, today: PlanDate): boolean {
  return expiresOn !== null && expiresOn < today;
}
