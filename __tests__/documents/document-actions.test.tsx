import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DocumentScreen } from '@/features/documents/document-screen';
import { LinkedEvents } from '@/features/documents/linked-events';
import { pagesHtml, sendOutDocument } from '@/features/documents/send-out';
import type { DocumentRow } from '@/features/documents/tables';
import { validateEvent } from '@/lib/analytics/schema';

let mockRows: Record<string, unknown[]> = {};
const mockRemove = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: jest.fn(), update: jest.fn(), remove: mockRemove }),
}));
jest.mock('@/features/people/data', () => ({ fetchPeople: async () => [] }));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { signOut: async () => ({ error: null }) } }),
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

// The read, the files and the share sheet, for send out.
const mockRead = jest.fn();
const mockDownload = jest.fn();
jest.mock('@/features/documents/read', () => ({
  readLinks: (...a: unknown[]) => mockRead(...a),
  downloadPages: (...a: unknown[]) => mockDownload(...a),
}));
const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    exists = true;
    create() {}
    delete() {
      mockDeleted.push(this.uri);
    }
    base64 = async () => 'AAAA';
  }
  return { Paths: { cache: 'file:///cache' }, Directory, File: Directory };
});
const mockPrint = jest.fn(async (_options: unknown) => ({ uri: 'file:///cache/print.pdf' }));
jest.mock('expo-print', () => ({ printToFileAsync: (o: unknown) => mockPrint(o) }));
const mockShare = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('expo-sharing', () => ({ shareAsync: (...a: unknown[]) => mockShare(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const household = { id: 'hh', locale: 'en-US' as const, timezone: 'America/New_York' };
const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const doc: DocumentRow = {
  ...base,
  id: 'd1',
  title: 'Insurance card',
  category: 'doc.insurance',
  person_id: null,
  expires_on: null,
  mime: 'image/jpeg',
  page_count: 2,
  size_bytes: 1000,
  status: 'ready',
  created_by: 'parent',
};
const onBack = jest.fn();

const show = async (isParent: boolean) => {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <DocumentScreen
        documentId="d1"
        household={household}
        online
        onBack={onBack}
        isParent={isParent}
      />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleted.length = 0;
  mockRows = { documents: [doc] };
});

describe('save or send out (FR2-DOC-9)', () => {
  it('sends one image as it is, then deletes the copy', async () => {
    mockRead.mockResolvedValue({ mime: 'image/jpeg', links: ['l1'] });
    mockDownload.mockResolvedValue(['file:///cache/vault-viewer/d1/out/1.jpg']);
    await sendOutDocument('d1', 'Save or send');
    expect(mockShare).toHaveBeenCalledWith('file:///cache/vault-viewer/d1/out/1.jpg', {
      mimeType: 'image/jpeg',
      UTI: 'public.jpeg',
      dialogTitle: 'Save or send',
    });
    expect(mockPrint).not.toHaveBeenCalled();
    expect(mockDeleted).toContain('file:///cache/vault-viewer/d1/out');
    expect(mockTrack).toHaveBeenCalledWith('document_sent_out', {});
    expect(validateEvent('document_sent_out', {})).toEqual({});
  });

  it('sends a scan of several pages as one PDF made on the device', async () => {
    mockRead.mockResolvedValue({ mime: 'image/jpeg', links: ['l1', 'l2'] });
    mockDownload.mockResolvedValue(['file:///a/1.jpg', 'file:///a/2.jpg']);
    await sendOutDocument('d1', 'Save or send');
    expect(pagesHtml(['AAAA', 'BBBB']).match(/<img/g)).toHaveLength(2);
    expect(mockShare).toHaveBeenCalledWith(
      'file:///cache/print.pdf',
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
    expect(mockDeleted).toContain('file:///cache/print.pdf');
  });

  it('deletes the copy even when the share sheet fails', async () => {
    mockRead.mockResolvedValue({ mime: 'application/pdf', links: ['l1'] });
    mockDownload.mockResolvedValue(['file:///a/1.pdf']);
    mockShare.mockRejectedValueOnce(new Error('no'));
    await expect(sendOutDocument('d1', 'Save or send')).rejects.toThrow();
    expect(mockDeleted).toContain('file:///cache/vault-viewer/d1/out');
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('is offered to parents with no Premium check, and not to others', async () => {
    mockRead.mockResolvedValue({ mime: 'image/jpeg', links: ['l1'] });
    mockDownload.mockResolvedValue(['file:///a/1.jpg']);
    await show(true);
    await fireEvent.press(screen.getByTestId('document-send-out'));
    expect(mockShare).toHaveBeenCalled();
  });

  it('hides send out and delete from family members and caregivers', async () => {
    await show(false);
    expect(screen.queryByTestId('document-send-out')).toBeNull();
    expect(screen.queryByTestId('document-delete')).toBeNull();
  });
});

describe('deleting (FR2-DOC-10)', () => {
  const confirm = () => {
    const buttons = (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as {
      style?: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
  };
  beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => undefined));

  it('asks first, hides it with an undo, and writes the delete when the undo goes', async () => {
    await show(true);
    await fireEvent.press(screen.getByTestId('document-delete'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete this document?',
      expect.any(String),
      expect.any(Array),
    );
    expect(mockRemove).not.toHaveBeenCalled();
    await act(async () => confirm());
    expect(screen.queryByTestId('document-details')).toBeNull();
    expect(screen.getByText('Document deleted')).toBeTruthy();

    await fireEvent(screen.getByTestId('document-undo'), 'dismiss');
    await act(async () => undefined);
    expect(mockRemove).toHaveBeenCalledWith('documents', 'd1');
    expect(mockTrack).toHaveBeenCalledWith('document_deleted', {});
    expect(onBack).toHaveBeenCalled();
  });

  it('brings it back on undo, writing nothing', async () => {
    await show(true);
    await fireEvent.press(screen.getByTestId('document-delete'));
    await act(async () => confirm());
    await fireEvent.press(screen.getByText('Undo'));
    expect(screen.getByTestId('document-details')).toBeTruthy();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('linked events (FR2-DOC-5)', () => {
  it('lists the events it is attached to, in time order, and opens them', async () => {
    const event = (id: string, title: string, startsAt: string) => ({
      ...base,
      id,
      title,
      kind: 'kind.appointment',
      all_day: false,
      starts_at: startsAt,
      ends_at: startsAt,
      start_date: null,
      end_date: null,
    });
    mockRows = {
      events: [
        event('e2', 'Dentist', '2026-12-02T15:00:00Z'),
        event('e1', 'Pediatrician', '2026-11-24T15:00:00Z'),
        event('e3', 'Not attached', '2026-11-25T15:00:00Z'),
      ],
      event_documents: [
        { ...base, id: 'l1', event_id: 'e2', document_id: 'd1' },
        { ...base, id: 'l2', event_id: 'e1', document_id: 'd1' },
        { ...base, id: 'l3', event_id: 'e3', document_id: 'd1', deleted_at: '2026-11-01' },
      ],
    };
    const onOpen = jest.fn();
    await render(
      <LinkedEvents documentId="d1" locale="en-US" timeZone="America/New_York" onOpen={onOpen} />,
    );
    const titles = screen.getAllByTestId(/^document-event-e\d$/).map((row) => row.props.testID);
    expect(titles).toEqual(['document-event-e1', 'document-event-e2']);
    expect(screen.getByText('Tue, Nov 24')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('document-event-e2'));
    expect(onOpen).toHaveBeenCalledWith('e2');
  });
});
