import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { addDocument, retryPendingUploads } from '@/features/documents/add-queue';
import type { Capture } from '@/features/documents/capture';
import { clearPendingUploads, pendingUploads } from '@/features/documents/pending-uploads';
import { UploadError } from '@/features/documents/upload';
import { validateEvent } from '@/lib/analytics/schema';

// Files by URI with their sizes; a missing size reads as 1 MB.
const mockSizes = new Map<string, number>();
const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    get size() {
      return mockSizes.get(uri) ?? 1024 * 1024;
    },
    exists: true,
    delete: () => mockDeleted.push(uri),
    arrayBuffer: async () => new ArrayBuffer(8),
  })),
}));
let mockSaved = 0;
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: jest.fn(() => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        width: 3000,
        height: 4000,
        saveAsync: async () => ({ uri: `file:///cache/saved-${++mockSaved}.jpg` }),
      }),
    })),
  },
}));
jest.mock('expo-camera', () => ({
  CameraView: { isDocumentScannerAvailable: true, scanDocumentAsync: jest.fn() },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `doc-${++mockUuid}` }));
const mockInvoke = jest.fn();
const mockUpload = jest.fn();
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => mockUpload(...a) }) },
    auth: { signOut: async () => ({ error: null }) },
  }),
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const refused = (code: string, status: number) =>
  new FunctionsHttpError(new Response(JSON.stringify({ error: { code } }), { status }));

const details = {
  title: ' Insurance card ',
  category: 'doc.insurance' as const,
  personId: null,
  expiresOn: '2027-03-01',
};
const capture = (pages = 2): Capture => ({
  source: 'scan',
  mime: 'image/jpeg',
  files: Array.from({ length: pages }, (_, i) => ({ uri: `file:///cache/p${i}.jpg`, size: 500 })),
  truncated: false,
});

/** The function answers begin with one token per file and finish with ready. */
function serverAccepts() {
  mockInvoke.mockImplementation(async (_name: string, { body }: { body: Record<string, any> }) =>
    body.action === 'begin'
      ? {
          data: {
            uploads: body.files.map((_: unknown, i: number) => ({
              path: `hh/${body.document_id}/${i + 1}.jpg`,
              token: `t${i}`,
            })),
          },
          error: null,
        }
      : { data: { status: 'ready' }, error: null },
  );
  mockUpload.mockResolvedValue({ data: {}, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSizes.clear();
  mockDeleted.length = 0;
  clearPendingUploads();
});

describe('adding a document (FR2-DOC-2, FR2-DOC-8, FR2-DOC-11)', () => {
  it('waits as a draft offline, and uploads when back online', async () => {
    serverAccepts();
    const result = await addDocument({
      householdId: 'hh',
      details,
      capture: capture(),
      online: false,
    });
    expect(result).toBe('waiting');
    expect(pendingUploads()).toEqual([
      expect.objectContaining({ householdId: 'hh', title: 'Insurance card', state: 'waiting' }),
    ]);
    expect(mockInvoke).not.toHaveBeenCalled();

    await retryPendingUploads();
    expect(pendingUploads()).toEqual([]);
    expect(mockDeleted).toEqual(['file:///cache/p0.jpg', 'file:///cache/p1.jpg']);
  });

  it('records the source, pages and size bucket only', async () => {
    serverAccepts();
    await addDocument({ householdId: 'hh', details, capture: capture(3), online: true });
    expect(mockTrack).toHaveBeenCalledWith('document_added', {
      source: 'scan',
      pages_count: 3,
      size_bucket: 'under_1mb',
    });
    expect(() =>
      validateEvent('document_added', { source: 'scan', pages_count: 3, size_bucket: 'under_1mb' }),
    ).not.toThrow();
    expect(JSON.stringify(mockTrack.mock.calls)).not.toMatch(/Insurance|insurance/);
  });

  it('keeps a half-finished upload waiting, then retries under a new ID', async () => {
    serverAccepts();
    mockUpload.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const first = await addDocument({
      householdId: 'hh',
      details,
      capture: capture(1),
      online: true,
    });
    expect(first).toBe('waiting');
    expect(pendingUploads()[0].state).toBe('failed');
    const firstId = mockInvoke.mock.calls[0][1].body.document_id;

    mockInvoke.mockImplementationOnce(async () => ({
      data: null,
      error: refused('documents.upload_incomplete', 409),
    }));
    await retryPendingUploads();
    const bodies = mockInvoke.mock.calls.map((call) => call[1].body);
    expect(bodies[1]).toEqual({ action: 'finish', document_id: firstId });
    expect(bodies[2]).toMatchObject({ action: 'begin' });
    expect(bodies[2].document_id).not.toBe(firstId);
    expect(pendingUploads()).toEqual([]);
  });

  it('throws a refusal and keeps no draft, so the screen can open the Premium sheet', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: refused('documents.limit', 402) });
    await expect(
      addDocument({ householdId: 'hh', details, capture: capture(), online: true }),
    ).rejects.toEqual(new UploadError('documents.limit'));
    expect(pendingUploads()).toEqual([]);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('waits when the function is unreachable', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsFetchError('down') });
    const result = await addDocument({
      householdId: 'hh',
      details,
      capture: capture(),
      online: true,
    });
    expect(result).toBe('waiting');
    expect(pendingUploads()[0].state).toBe('failed');
  });
});
