import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AttachDocumentsScreen } from '@/features/documents/attach-screen';
import {
  applyAttachmentChanges,
  attachDocument,
  attachedDocuments,
} from '@/features/documents/attachments';
import { EventAttachments } from '@/features/documents/event-attachments';
import type { DocumentRow, EventDocumentRow } from '@/features/documents/tables';
import { validateEvent } from '@/lib/analytics/schema';

let mockRows: Record<string, unknown[]> = {};
const mockInsert = jest.fn(async (..._args: unknown[]) => ({}));
const mockRemove = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: jest.fn(), remove: mockRemove }),
}));
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false }),
}));
const mockOpenPremiumSheet = jest.fn();
jest.mock('@/features/subscription/premium-sheet', () => ({
  usePremiumSheet: () => ({ openPremiumSheet: mockOpenPremiumSheet }),
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `link-${++mockUuid}` }));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const doc = (id: string, title: string, over: Partial<DocumentRow> = {}): DocumentRow => ({
  ...base,
  id,
  title,
  category: 'doc.insurance',
  person_id: null,
  expires_on: null,
  mime: 'image/jpeg',
  page_count: 1,
  size_bytes: 1000,
  status: 'ready',
  created_by: 'parent',
  ...over,
});
const link = (
  id: string,
  eventId: string,
  documentId: string,
  deleted = false,
): EventDocumentRow => ({
  ...base,
  id,
  event_id: eventId,
  document_id: documentId,
  deleted_at: deleted ? '2026-11-22T00:00:00Z' : null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  mockRows = {};
});

describe('attached documents (FR2-DOC-5, R2-ACC-1)', () => {
  it("lists the event's live attachments by title", () => {
    const docs = [doc('d1', 'Passport'), doc('d2', 'insurance card'), doc('d3', 'School form')];
    const links = [link('l1', 'e1', 'd1'), link('l2', 'e1', 'd2'), link('l3', 'e2', 'd3')];
    expect(attachedDocuments(links, docs, 'e1', 'en-US').map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('leaves out detached documents and documents this member cannot see', () => {
    // A caregiver's copy: the event and its link arrive only with a share, and d2 isn't shared.
    const docs = [doc('d1', 'Insurance card')];
    const links = [link('l1', 'e1', 'd1', true), link('l2', 'e1', 'd2')];
    expect(attachedDocuments(links, docs, 'e1', 'en-US')).toEqual([]);
  });
});

describe('saving attachments (FR2-DOC-5)', () => {
  const writer = { insert: mockInsert, remove: mockRemove };
  const newId = () => `link-${++mockUuid}`;

  it('writes only the ticks the parent changed', async () => {
    const links = [link('l1', 'e1', 'd1'), link('l2', 'e1', 'd2')];
    const changes = new Map([
      ['d1', false],
      ['d3', true],
      // Ticked again after unticking: no change.
      ['d2', true],
    ]);
    expect(await applyAttachmentChanges(writer, 'e1', links, changes, newId)).toBe(1);
    expect(mockRemove).toHaveBeenCalledWith('event_documents', 'l1');
    expect(mockInsert).toHaveBeenCalledWith('event_documents', 'link-1', {
      event_id: 'e1',
      document_id: 'd3',
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('never undoes an attachment made meanwhile', async () => {
    // A new document finished uploading and attached itself after the screen opened.
    const links = [link('l9', 'e1', 'd9')];
    await applyAttachmentChanges(writer, 'e1', links, new Map([['d1', true]]), newId);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('attaches a new document and records document_attached with no category', async () => {
    await attachDocument(writer, 'e1', 'd5', newId);
    expect(mockInsert).toHaveBeenCalledWith('event_documents', 'link-1', {
      event_id: 'e1',
      document_id: 'd5',
    });
    expect(mockTrack).toHaveBeenCalledWith('document_attached', {});
    expect(() => validateEvent('document_attached', {})).not.toThrow();
  });
});

describe('event detail attachments (S-38)', () => {
  const show = async (isParent: boolean) => {
    const onOpen = jest.fn();
    const onAttach = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <EventAttachments
          eventId="e1"
          locale="en-US"
          isParent={isParent}
          onOpen={onOpen}
          onAttach={onAttach}
        />
      </SafeAreaProvider>,
    );
    return { onOpen, onAttach };
  };

  it('lets a parent open an attachment and attach more', async () => {
    mockRows = {
      documents: [doc('d1', 'Insurance card')],
      event_documents: [link('l1', 'e1', 'd1')],
    };
    const { onOpen, onAttach } = await show(true);
    expect(screen.getByText('Insurance card')).toBeTruthy();
    expect(screen.getByText('Insurance')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('event-attachment-d1'));
    expect(onOpen).toHaveBeenCalledWith('d1');
    await fireEvent.press(screen.getByTestId('event-attach'));
    expect(onAttach).toHaveBeenCalled();
  });

  it('shows a caregiver without a share nothing at all', async () => {
    // Their copy has the event but neither the document nor the link (R2-ACC-1).
    mockRows = { documents: [], event_documents: [] };
    await show(false);
    expect(screen.queryByTestId('event-attachments')).toBeNull();
    expect(screen.queryByTestId('event-attach')).toBeNull();
  });

  it('shows a caregiver a shared attachment, with no attach action', async () => {
    mockRows = {
      documents: [doc('d1', 'Insurance card')],
      event_documents: [link('l1', 'e1', 'd1')],
    };
    await show(false);
    expect(screen.getByTestId('event-attachment-d1')).toBeTruthy();
    expect(screen.queryByTestId('event-attach')).toBeNull();
  });
});

describe('attach screen', () => {
  const show = async () => {
    const onBack = jest.fn();
    const onAddNew = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <AttachDocumentsScreen eventId="e1" locale="en-US" onBack={onBack} onAddNew={onAddNew} />
      </SafeAreaProvider>,
    );
    await act(async () => undefined);
    return { onBack, onAddNew };
  };

  it('ticks attached documents and saves the changes', async () => {
    mockRows = {
      documents: [doc('d1', 'Insurance card'), doc('d2', 'Passport', { category: 'doc.identity' })],
      event_documents: [link('l1', 'e1', 'd1')],
    };
    const { onBack } = await show();
    expect(screen.getByTestId('attach-save')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('attach-document-d2'));
    await fireEvent.press(screen.getByTestId('attach-document-d1'));
    await fireEvent.press(screen.getByTestId('attach-save'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledWith('event_documents', 'link-1', {
      event_id: 'e1',
      document_id: 'd2',
    });
    expect(mockRemove).toHaveBeenCalledWith('event_documents', 'l1');
    expect(mockTrack).toHaveBeenCalledWith('document_attached', {});
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalled();
  });

  it('adds a new document, or opens the Premium sheet at the Free limit', async () => {
    const { onAddNew } = await show();
    expect(screen.getByTestId('attach-empty')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('vault-add'));
    expect(onAddNew).toHaveBeenCalled();

    mockRows = {
      documents: Array.from({ length: 25 }, (_, i) => doc(`d${i}`, `Doc ${i}`)),
      event_documents: [],
    };
    const again = await show();
    await fireEvent.press(screen.getAllByTestId('vault-add').at(-1)!);
    expect(again.onAddNew).not.toHaveBeenCalled();
    expect(mockOpenPremiumSheet).toHaveBeenCalledWith('documents');
  });
});
