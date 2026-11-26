import { FunctionsHttpError } from '@supabase/supabase-js';
import { CameraView } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';

import {
  fitPage,
  MAX_FILE_BYTES,
  pickFile,
  scan,
  storedMime,
  type Capture,
} from '@/features/documents/capture';
import { sizeBucket, uploadDocument, UploadError } from '@/features/documents/upload';

// Files by URI with their sizes; a missing size reads as 1 MB.
const mockSizes = new Map<string, number>();
// Files' first bytes; a missing entry starts like a real PDF or PNG, by extension.
const mockHeads = new Map<string, number[]>();
const mockSigned = (uri: string) =>
  uri.endsWith('.png')
    ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    : [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
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
    open: () => ({
      readBytesSync: (n: number) =>
        Uint8Array.from((mockHeads.get(uri) ?? mockSigned(uri)).slice(0, n)),
      close: () => {},
    }),
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
const mockInvoke = jest.fn();
const mockUpload = jest.fn();
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => mockUpload(...a) }) },
    auth: { signOut: async () => ({ error: null }) },
  }),
}));

const scanner = CameraView as unknown as { scanDocumentAsync: jest.Mock };
const picker = DocumentPicker as unknown as { getDocumentAsync: jest.Mock };

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
  mockHeads.clear();
  mockDeleted.length = 0;
});

describe('capture (FR2-DOC-2)', () => {
  it('resizes to a 2,000 px long edge and stores HEIC as JPEG', () => {
    expect(fitPage(3000, 4000)).toEqual({ width: null, height: 2000 });
    expect(fitPage(1200, 900)).toBeNull();
    expect(storedMime('image/heic', 'IMG_1.HEIC')).toBe('image/jpeg');
    expect(storedMime(null, 'scan.heif')).toBe('image/jpeg');
    expect(storedMime('image/png', 'card.png')).toBe('image/png');
    expect(storedMime('application/pdf', 'form.pdf')).toBe('application/pdf');
    expect(storedMime('application/zip', 'x.zip')).toBeNull();
  });

  it('keeps the first 20 scanned pages, as JPEGs, and deletes the scanner files', async () => {
    const pages = Array.from({ length: 22 }, (_, i) => `file:///scanner/${i}.jpg`);
    scanner.scanDocumentAsync.mockResolvedValue({ pages });
    const outcome = await scan();
    expect(outcome.status).toBe('captured');
    if (outcome.status !== 'captured') return;
    expect(outcome.capture.files).toHaveLength(20);
    expect(outcome.capture.truncated).toBe(true);
    expect(outcome.capture.mime).toBe('image/jpeg');
    expect(mockDeleted).toEqual(expect.arrayContaining(pages));
  });

  it('treats a cancelled scan as cancelled', async () => {
    scanner.scanDocumentAsync.mockResolvedValue(null);
    expect(await scan()).toEqual({ status: 'canceled' });
  });

  it('converts a picked HEIC and refuses files over 10 MB or of other types', async () => {
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///pick/a.heic', name: 'a.heic', mimeType: 'image/heic', size: 3 }],
    });
    const heic = await pickFile();
    expect(heic.status === 'captured' && heic.capture.files[0].uri).toMatch(/saved-\d+\.jpg$/);

    mockSizes.set('file:///pick/big.pdf', MAX_FILE_BYTES + 1);
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///pick/big.pdf', name: 'big.pdf', mimeType: 'application/pdf' }],
    });
    expect(await pickFile()).toEqual({ status: 'too_large' });
    expect(mockDeleted).toContain('file:///pick/big.pdf');

    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///pick/a.doc', name: 'a.doc', mimeType: 'application/msword' }],
    });
    expect(await pickFile()).toEqual({ status: 'unsupported' });
  });

  it('keeps a picked PDF or PNG only if its bytes are that type (SR2-L3)', async () => {
    const pick = (uri: string, mimeType: string) =>
      picker.getDocumentAsync.mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri, name: uri.split('/').pop(), mimeType, size: 3 }],
      });
    pick('file:///pick/form.pdf', 'application/pdf');
    expect((await pickFile()).status).toBe('captured');
    pick('file:///pick/card.png', 'image/png');
    expect((await pickFile()).status).toBe('captured');

    // A web page named .pdf, and a JPEG named .png.
    mockHeads.set('file:///pick/page.pdf', [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x3c, 0x73]);
    pick('file:///pick/page.pdf', 'application/pdf');
    expect(await pickFile()).toEqual({ status: 'unsupported' });
    expect(mockDeleted).toContain('file:///pick/page.pdf');
    mockHeads.set('file:///pick/photo.png', [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
    pick('file:///pick/photo.png', 'image/png');
    expect(await pickFile()).toEqual({ status: 'unsupported' });
    expect(mockDeleted).toContain('file:///pick/photo.png');
  });
});

describe('upload (V-02.2)', () => {
  it('begins, uploads each file to its signed URL and finishes', async () => {
    serverAccepts();
    await uploadDocument({ householdId: 'hh', documentId: 'd1', details, capture: capture() });
    const begin = mockInvoke.mock.calls[0][1].body;
    expect(begin).toMatchObject({
      action: 'begin',
      household_id: 'hh',
      document_id: 'd1',
      title: 'Insurance card',
      category: 'doc.insurance',
      expires_on: '2027-03-01',
      mime: 'image/jpeg',
      files: [{ size: 500 }, { size: 500 }],
    });
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpload.mock.calls[1].slice(0, 2)).toEqual(['hh/d1/2.jpg', 't1']);
    expect(mockInvoke.mock.calls[1][1].body).toEqual({ action: 'finish', document_id: 'd1' });
  });

  it('stops at the limit without uploading anything', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: refused('documents.limit', 402) });
    await expect(
      uploadDocument({ householdId: 'hh', documentId: 'd1', details, capture: capture() }),
    ).rejects.toEqual(new UploadError('documents.limit'));
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('buckets sizes for analytics', () => {
    expect(sizeBucket(500_000)).toBe('under_1mb');
    expect(sizeBucket(3 * 1024 * 1024)).toBe('1_5mb');
    expect(sizeBucket(30 * 1024 * 1024)).toBe('over_20mb');
  });
});
