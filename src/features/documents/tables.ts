import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

/**
 * The document vault's metadata in the household sync layer (V-02.1, FR2-DOC-1, architecture
 * section 3.5). Files never sync; only these rows do, so the vault lists offline (NFR2-OFF-1).
 * All three are scoped: a member who loses a share loses the rows from their device (C-01.3).
 * Plain definitions with no app imports, so the two-device harness can use them too.
 */
export const DOCUMENTS = {
  name: 'documents',
  scoped: true,
  columns: {
    title: 'text',
    category: 'text',
    person_id: 'text',
    expires_on: 'text',
    mime: 'text',
    page_count: 'integer',
    size_bytes: 'integer',
    status: 'text',
    created_by: 'text',
  },
} as const satisfies SyncTableDefinition;

export const DOCUMENT_SHARES = {
  name: 'document_shares',
  scoped: true,
  columns: {
    document_id: 'text',
    user_id: 'text',
    shared_by: 'text',
  },
} as const satisfies SyncTableDefinition;

export const EVENT_DOCUMENTS = {
  name: 'event_documents',
  scoped: true,
  columns: {
    event_id: 'text',
    document_id: 'text',
  },
} as const satisfies SyncTableDefinition;

export const DOCUMENT_TABLES = [DOCUMENTS, DOCUMENT_SHARES, EVENT_DOCUMENTS] as const;

/** Categories, stored as identifiers; names come from translations (NFR2-L10N-1). */
export const DOCUMENT_CATEGORIES = [
  'doc.insurance',
  'doc.identity',
  'doc.childcare_school',
  'doc.medical',
  'doc.household',
  'doc.other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return (DOCUMENT_CATEGORIES as readonly unknown[]).includes(value);
}

/** The database checks these too. */
export const DOCUMENT_LIMITS = { titleLength: 200, pages: 20 } as const;

/** The server's hints when a share is refused (FR2-PAY-1 trigger `document_share`). */
export const SHARE_PREMIUM_HINT = 'documents.share_premium';
export const SHARE_MEMBER_HINT = 'documents.share_member';

export type DocumentMime = 'application/pdf' | 'image/jpeg' | 'image/png';

export type DocumentRow = SyncRow & {
  /** The only free text (R2-DOC-3). Never sent to analytics, logs or Sentry (NFR2-SEC-2). */
  title: string;
  category: DocumentCategory;
  person_id: string | null;
  /** `YYYY-MM-DD`, or null. */
  expires_on: string | null;
  /** Set by the server from the stored files. */
  mime: DocumentMime;
  page_count: number;
  size_bytes: number;
  /** Clients only ever see `ready` rows. */
  status: 'uploading' | 'ready';
  created_by: string | null;
};

export type DocumentShareRow = SyncRow & {
  document_id: string;
  /** The family member or caregiver it's shared with (D-16). */
  user_id: string;
  shared_by: string | null;
};

export type EventDocumentRow = SyncRow & {
  event_id: string;
  document_id: string;
};
