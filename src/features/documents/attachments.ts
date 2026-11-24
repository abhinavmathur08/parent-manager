import { useMemo } from 'react';

import { track } from '@/lib/analytics';
import { useSyncedRows } from '@/lib/sync';

import { EVENT_DOCUMENTS, type DocumentRow, type EventDocumentRow } from './tables';
import { useDocuments } from './vault-list';

/** The sync writer's calls these use (`useSyncWriter`, or the engine in the harness). */
export type AttachmentWriter = {
  insert: (table: string, id: string, values: Record<string, string>) => Promise<unknown>;
  remove: (table: string, id: string) => Promise<unknown>;
};

/**
 * The documents attached to an event that this member can see (FR2-DOC-5). The local copy
 * holds only attachments whose event and document both reach the member (R2-ACC-1, C-01.3),
 * and a link to a document missing here is left out too, so nothing hidden ever shows.
 * Sorted by title in the locale's order, never by category name (NFR2-L10N-1).
 */
export function attachedDocuments(
  links: readonly EventDocumentRow[],
  documents: readonly DocumentRow[],
  eventId: string,
  locale: string,
): DocumentRow[] {
  const ids = new Set(
    links.filter((l) => !l.deleted_at && l.event_id === eventId).map((l) => l.document_id),
  );
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return documents
    .filter((doc) => ids.has(doc.id))
    .sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id));
}

/** The event's live attachments, by document ID. */
export function liveAttachments(
  links: readonly EventDocumentRow[],
  eventId: string,
): Map<string, EventDocumentRow> {
  const map = new Map<string, EventDocumentRow>();
  for (const link of links) {
    if (!link.deleted_at && link.event_id === eventId) map.set(link.document_id, link);
  }
  return map;
}

/**
 * Applies a parent's ticks on the attach screen: only the documents they changed, so an
 * attachment made meanwhile (a new document that finished uploading) is never undone.
 * Returns how many were attached.
 */
export async function applyAttachmentChanges(
  writer: AttachmentWriter,
  eventId: string,
  links: readonly EventDocumentRow[],
  changes: ReadonlyMap<string, boolean>,
  newId: () => string,
): Promise<number> {
  const live = liveAttachments(links, eventId);
  let attached = 0;
  for (const [documentId, attach] of changes) {
    const existing = live.get(documentId);
    if (attach && !existing) {
      await writer.insert(EVENT_DOCUMENTS.name, newId(), {
        event_id: eventId,
        document_id: documentId,
      });
      attached += 1;
    } else if (!attach && existing) {
      await writer.remove(EVENT_DOCUMENTS.name, existing.id);
    }
  }
  return attached;
}

/** Attaches one document, for a new one added from an event (FR2-DOC-5). */
export async function attachDocument(
  writer: AttachmentWriter,
  eventId: string,
  documentId: string,
  newId: () => string,
): Promise<void> {
  await writer.insert(EVENT_DOCUMENTS.name, newId(), {
    event_id: eventId,
    document_id: documentId,
  });
  // No category, title or person (FR2-DOC-11).
  track('document_attached', {});
}

/** The visible documents attached to an event, from the local copy. */
export function useEventAttachments(eventId: string, locale: string): DocumentRow[] {
  const links = useSyncedRows<EventDocumentRow>(EVENT_DOCUMENTS.name).rows;
  const { documents } = useDocuments();
  return useMemo(
    () => attachedDocuments(links, documents, eventId, locale),
    [links, documents, eventId, locale],
  );
}
