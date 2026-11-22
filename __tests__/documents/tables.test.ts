import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TABLES,
  DOCUMENTS,
  isDocumentCategory,
} from '@/features/documents/tables';
import { validateDefinition } from '@/lib/sync/registry';

describe('document sync tables (V-02.1)', () => {
  it('are valid sync table definitions', () => {
    for (const table of DOCUMENT_TABLES) {
      expect(() => validateDefinition(table)).not.toThrow();
    }
  });

  it('are all scoped, so an unshare or a lapse drops them from the device (C-01.3)', () => {
    expect(DOCUMENT_TABLES.map((table) => [table.name, table.scoped])).toEqual([
      ['documents', true],
      ['document_shares', true],
      ['event_documents', true],
    ]);
  });

  it('syncs metadata only: the title is the one free-text column (R2-DOC-3, D-19)', () => {
    expect(Object.keys(DOCUMENTS.columns).sort()).toEqual([
      'category',
      'created_by',
      'expires_on',
      'mime',
      'page_count',
      'person_id',
      'size_bytes',
      'status',
      'title',
    ]);
  });

  it('stores categories as identifiers', () => {
    expect(DOCUMENT_CATEGORIES.every((category) => category.startsWith('doc.'))).toBe(true);
    expect(isDocumentCategory('doc.medical')).toBe(true);
    expect(isDocumentCategory('Medical')).toBe(false);
  });
});
