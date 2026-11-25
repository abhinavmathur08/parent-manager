import { DOCUMENT_SHARES, type DocumentShareRow } from './tables';

/**
 * Sharing documents with named family members and caregivers (FR2-DOC-6, D-16). Plain
 * functions over the sync writer with no app imports, so the two-device harness drives the
 * same writes as the app. Unsharing tombstones the row; the member's device drops the
 * document on its next visibility check (C-01.3, R2-ACC-2).
 */
export type ShareWriter = {
  insert: (table: string, id: string, values: Record<string, string | null>) => Promise<unknown>;
  remove: (table: string, id: string) => Promise<unknown>;
};

/** A document's live shares, by member. */
export function liveShares(
  shares: readonly DocumentShareRow[],
  documentId: string,
): Map<string, DocumentShareRow> {
  const map = new Map<string, DocumentShareRow>();
  for (const share of shares) {
    if (!share.deleted_at && share.document_id === documentId) map.set(share.user_id, share);
  }
  return map;
}

/**
 * Applies a parent's ticks for one document: only the members they changed. Returns how many
 * were shared and unshared.
 */
export async function applyShareChanges(
  writer: ShareWriter,
  documentId: string,
  shares: readonly DocumentShareRow[],
  changes: ReadonlyMap<string, boolean>,
  newId: () => string,
): Promise<{ shared: number; unshared: number }> {
  const live = liveShares(shares, documentId);
  const result = { shared: 0, unshared: 0 };
  for (const [userId, share] of changes) {
    const existing = live.get(userId);
    if (share && !existing) {
      // The server sets shared_by to the caller.
      await writer.insert(DOCUMENT_SHARES.name, newId(), {
        document_id: documentId,
        user_id: userId,
        shared_by: null,
      });
      result.shared += 1;
    } else if (!share && existing) {
      await writer.remove(DOCUMENT_SHARES.name, existing.id);
      result.unshared += 1;
    }
  }
  return result;
}

/**
 * Shares each document with each member, skipping shares that already exist: "share the
 * attachments too" when a parent shares an event (FR2-DOC-6). Returns how many were added.
 */
export async function shareDocuments(
  writer: ShareWriter,
  documentIds: readonly string[],
  userIds: readonly string[],
  shares: readonly DocumentShareRow[],
  newId: () => string,
): Promise<number> {
  let added = 0;
  for (const documentId of documentIds) {
    const changes = new Map(userIds.map((userId) => [userId, true]));
    added += (await applyShareChanges(writer, documentId, shares, changes, newId)).shared;
  }
  return added;
}
