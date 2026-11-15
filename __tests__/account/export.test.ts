import {
  csvField,
  exportCsvFiles,
  exportEntries,
  shareExport,
  sizeBucket,
  toCsv,
  type ExportData,
} from '@/features/account/export';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc }) }));
const mockWrite = jest.fn(async () => undefined);
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: jest.fn().mockImplementation((dir: string, name: string) => ({
    uri: `${dir}/${name}`,
    exists: false,
    create: jest.fn(),
    delete: jest.fn(),
    write: mockWrite,
  })),
}));
const mockShare = jest.fn(async (..._args: unknown[]) => undefined);
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
    expect(mockWrite).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(mockShare).toHaveBeenCalledWith(
      'file:///cache/parent-manager-household-2026-11-18.zip',
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

  it('buckets sizes without exact numbers', () => {
    expect(sizeBucket(5_000)).toBe('under_100kb');
    expect(sizeBucket(5_000_000)).toBe('under_10mb');
  });
});
