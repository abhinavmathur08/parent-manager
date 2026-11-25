import { crc32 } from '@/lib/zip';
import {
  csvField,
  documentsWithFiles,
  exportCsvFiles,
  exportEntries,
  shareExport,
  sizeBucket,
  toCsv,
  type ExportData,
} from '@/features/account/export';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc }) }));

// An in-memory cache folder: paths to bytes, plus the folders that exist.
const mockDisk = new Map<string, Uint8Array>();
const mockDirs = new Set<string>();
const mockPath = (parent: unknown, name?: string) => {
  const base = typeof parent === 'string' ? parent : (parent as { uri: string }).uri;
  return name ? `${base}/${name}` : base;
};
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  FileMode: { WriteOnly: 'w' },
  Directory: jest.fn().mockImplementation((parent: unknown, name?: string) => {
    const uri = mockPath(parent, name);
    return {
      uri,
      get exists() {
        return mockDirs.has(uri);
      },
      create: () => mockDirs.add(uri),
      delete: () => {
        mockDirs.forEach((d) => d.startsWith(uri) && mockDirs.delete(d));
        mockDisk.forEach((_, f) => f.startsWith(`${uri}/`) && mockDisk.delete(f));
      },
    };
  }),
  File: jest.fn().mockImplementation((parent: unknown, name?: string) => {
    const uri = mockPath(parent, name);
    return {
      uri,
      name: uri.split('/').pop(),
      get exists() {
        return mockDisk.has(uri);
      },
      create: () => mockDisk.set(uri, new Uint8Array()),
      delete: () => mockDisk.delete(uri),
      bytes: async () => mockDisk.get(uri)!,
      open: () => ({
        writeBytes: async (bytes: Uint8Array) => {
          const before = mockDisk.get(uri)!;
          const next = new Uint8Array(before.length + bytes.length);
          next.set(before);
          next.set(bytes, before.length);
          mockDisk.set(uri, next);
        },
        close: () => undefined,
      }),
    };
  }),
}));

// The documents function's read links, and their files in storage.
const mockStored: Record<string, { mime: string; pages: string[] } | 'not_found' | 'down'> = {};
jest.mock('@/features/documents/upload', () => {
  class UploadError extends Error {
    code: string;
    constructor(mockCode: string) {
      super(mockCode);
      this.code = mockCode;
    }
  }
  return { UploadError };
});
jest.mock('@/features/documents/read', () => {
  const { UploadError } = jest.requireMock('@/features/documents/upload');
  return {
    readLinks: async (id: string) => {
      const doc = mockStored[id];
      if (doc === 'not_found') throw new UploadError('documents.not_found');
      if (doc === 'down' || !doc) throw new UploadError('documents.network');
      return { mime: doc.mime, links: doc.pages.map((_, i) => `https://x/${id}/${i}`) };
    },
    downloadPages: async (links: string[], folder: { uri: string }, mime: string) =>
      links.map((link, i) => {
        const [id, page] = link.split('/').slice(-2);
        const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
        const uri = `${folder.uri}/${i + 1}.${ext}`;
        const doc = mockStored[id] as { pages: string[] };
        mockDisk.set(uri, new TextEncoder().encode(doc.pages[Number(page)]));
        return uri;
      }),
  };
});
jest.mock('@/features/auth/sign-out', () => ({ onSignOut: jest.fn() }));
const mockShare = jest.fn(async (..._args: unknown[]) => {
  mockShared = mockDisk.get(String(_args[0])) ?? null;
});
let mockShared: Uint8Array | null = null;
jest.mock('expo-sharing', () => ({ shareAsync: (...args: unknown[]) => mockShare(...args) }));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));

const data: ExportData = {
  format: 'parent-manager-export',
  version: 1,
  scope: 'household',
  exported_at: '2026-11-18T12:00:00Z',
  tables: {
    households: [{ id: 'hh', name: 'Home' }],
    recipes: [
      { id: 'r2', title: 'Soup, "best"', servings: 4, tags: ['quick'] },
      { id: 'r1', title: 'Apple pie', servings: 8, tags: [] },
    ],
    plan_entries: [
      { date: '2026-11-17', slot: 'dinner', position: 0, recipe_id: 'r2', servings: 4 },
      { date: '2026-11-16', slot: 'dinner', position: 0, recipe_id: null, free_text: 'Takeout' },
    ],
    grocery_lists: [{ id: 'l1', week_start: '2026-11-15' }],
    grocery_items: [
      {
        id: 'i1',
        list_id: 'l1',
        ingredient_id: 'ingredient.milk',
        quantity_base: 946,
        checked: true,
      },
    ],
    purchase_events: [{ id: 'e1', item_id: 'i1' }],
  },
};

/** Reads a stored ZIP back through its central directory, checking each entry's CRC. */
function unzip(zip: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let i = 0; i < count; i++) {
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.slice(at + 46, at + 46 + nameLength));
    const local = view.getUint32(at + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true);
    out[name] = zip.slice(start, start + size);
    expect(crc32(out[name])).toBe(crc);
    at += 46 + nameLength;
  }
  return out;
}

describe('CSV (FR-PRIV-2)', () => {
  it('quotes fields that need it', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a, "b"')).toBe('"a, ""b"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(null)).toBe('');
    expect(csvField(['quick'])).toBe('"[""quick""]"');
    expect(toCsv(['a', 'b'], [{ a: 1, b: true }])).toBe('a,b\r\n1,true\r\n');
  });

  it('writes recipes, plans and lists, sorted, with the recipe titles and list weeks', () => {
    const files = exportCsvFiles(data.tables);
    expect(Object.keys(files).sort()).toEqual(['grocery_lists.csv', 'plans.csv', 'recipes.csv']);
    expect(files['recipes.csv'].split('\r\n')[1]).toMatch(/^r1,Apple pie,8/);
    expect(files['plans.csv'].split('\r\n')[1]).toBe('2026-11-16,dinner,0,,,Takeout,');
    expect(files['plans.csv'].split('\r\n')[2]).toBe('2026-11-17,dinner,0,r2,"Soup, ""best""",,4');
    expect(files['grocery_lists.csv'].split('\r\n')[1]).toMatch(
      /^2026-11-15,ingredient\.milk,,946/,
    );
  });
});

describe('exportEntries', () => {
  it('has a manifest, a JSON file per data type and the CSV files', () => {
    const names = exportEntries(data).map((e) => e.name);
    expect(names[0]).toBe('manifest.json');
    expect(names).toEqual(
      expect.arrayContaining([
        'households.json',
        'recipes.json',
        'plan_entries.json',
        'grocery_items.json',
        'purchase_events.json',
        'recipes.csv',
        'plans.csv',
        'grocery_lists.csv',
      ]),
    );
  });
});

describe('shareExport', () => {
  it('asks the server, writes the ZIP and opens the share sheet', async () => {
    mockRpc.mockResolvedValueOnce({ data, error: null });
    await shareExport({
      scope: 'household',
      householdId: 'hh',
      dialogTitle: 'Share',
      now: new Date('2026-11-18T12:00:00Z'),
    });
    expect(mockRpc).toHaveBeenCalledWith('export_household_data', { target: 'hh' });
    expect(mockShared?.length).toBeGreaterThan(0);
    expect(mockShare).toHaveBeenCalledWith(
      'file:///cache/data-export/parent-manager-household-2026-11-18.zip',
      expect.objectContaining({ mimeType: 'application/zip' }),
    );
    expect(mockTrack).toHaveBeenCalledWith('data_export_requested', { scope: 'household' });
    expect(mockTrack).toHaveBeenCalledWith('data_export_completed', {
      scope: 'household',
      size_bucket: 'under_100kb',
    });
  });

  it('exports the account through its own call, and passes errors on', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    await expect(
      shareExport({ scope: 'account', householdId: 'hh', dialogTitle: 'Share' }),
    ).rejects.toThrow('offline');
    expect(mockRpc).toHaveBeenLastCalledWith('export_account_data');
    expect(mockShare).not.toHaveBeenCalledWith(
      expect.stringContaining('account'),
      expect.anything(),
    );
  });

  it("puts every ready document's files in documents/ and keeps nothing after (FR2-PRIV-1)", async () => {
    mockStored['doc-1'] = { mime: 'image/jpeg', pages: ['page one', 'page two'] };
    mockStored['doc-2'] = { mime: 'application/pdf', pages: ['%PDF'] };
    mockStored['doc-gone'] = 'not_found';
    const withDocuments: ExportData = {
      ...data,
      tables: {
        ...data.tables,
        documents: [
          { id: 'doc-2', status: 'ready' },
          { id: 'doc-1', status: 'ready' },
          { id: 'doc-gone', status: 'ready' },
          { id: 'doc-half', status: 'uploading' },
        ],
      },
    };
    mockRpc.mockResolvedValueOnce({ data: withDocuments, error: null });
    await shareExport({ scope: 'household', householdId: 'hh', dialogTitle: 'Share' });

    const entries = unzip(mockShared!);
    expect(new TextDecoder().decode(entries['documents/doc-1/1.jpg'])).toBe('page one');
    expect(new TextDecoder().decode(entries['documents/doc-1/2.jpg'])).toBe('page two');
    expect(new TextDecoder().decode(entries['documents/doc-2/1.pdf'])).toBe('%PDF');
    expect(Object.keys(entries).filter((n) => n.startsWith('documents/'))).toHaveLength(3);
    expect(entries['documents.json']).toBeDefined();
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
    expect(manifest.document_files).toEqual([
      'documents/doc-1/1.jpg',
      'documents/doc-1/2.jpg',
      'documents/doc-2/1.pdf',
    ]);
    expect(manifest.documents_without_files).toEqual(['doc-gone']);
    // Nothing stays in the cache once the share sheet closes (FR2-DOC-4).
    expect([...mockDisk.keys()]).toEqual([]);
  });

  it('fails rather than leave a document out when its files cannot be read', async () => {
    mockStored['doc-down'] = 'down';
    mockRpc.mockResolvedValueOnce({
      data: {
        ...data,
        tables: { ...data.tables, documents: [{ id: 'doc-down', status: 'ready' }] },
      },
      error: null,
    });
    mockShare.mockClear();
    await expect(
      shareExport({ scope: 'household', householdId: 'hh', dialogTitle: 'Share' }),
    ).rejects.toThrow('documents.network');
    expect(mockShare).not.toHaveBeenCalled();
    expect([...mockDisk.keys()]).toEqual([]);
  });

  it('clears exports on sign-out', () => {
    mockDirs.add('file:///cache/data-export');
    mockDisk.set('file:///cache/data-export/old.zip', new Uint8Array(1));
    const { onSignOut } = jest.requireMock('@/features/auth/sign-out');
    (onSignOut as jest.Mock).mock.calls.forEach(([cleanup]: [() => void]) => cleanup());
    expect(mockDisk.size).toBe(0);
  });

  it('only sends files for documents that finished uploading', () => {
    expect(
      documentsWithFiles({
        documents: [
          { id: 'b', status: 'ready' },
          { id: 'a', status: 'ready' },
          { id: 'c', status: 'uploading' },
        ],
      }),
    ).toEqual(['a', 'b']);
    expect(documentsWithFiles({})).toEqual([]);
  });

  it('buckets sizes without exact numbers', () => {
    expect(sizeBucket(5_000)).toBe('under_100kb');
    expect(sizeBucket(5_000_000)).toBe('under_10mb');
  });
});
