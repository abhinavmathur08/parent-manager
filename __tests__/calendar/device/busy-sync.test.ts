import { signOut } from '@/features/auth/sign-out';
import {
  refreshBusyTimes,
  stopBusyTimes,
  type BlockWriter,
} from '@/features/calendar/device/busy-sync';
import { DEFAULT_BUSY_TIMES } from '@/features/calendar/device/busy-times';
import type { BusyBlockRow } from '@/features/calendar/tables';

const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => void mockStore.set(key, value),
    removeItemSync: (key: string) => mockStore.delete(key),
    getAllKeys: async () => [...mockStore.keys()],
    removeItem: async (key: string) => void mockStore.delete(key),
  },
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `block-${++mockUuid}` }));

/** Full device events, as the phone returns them: titles, places, notes and attendees. */
let mockDeviceEvents: Record<string, unknown>[] = [];
const mockListEvents = jest.fn(async (..._args: unknown[]) => mockDeviceEvents);
jest.mock('expo-calendar', () => ({
  EventStatus: { CANCELED: 'canceled' },
  listEvents: (...args: unknown[]) => mockListEvents(...args),
}));

const mockServer = { calls: [] as unknown[][], error: null as unknown };
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { signOut: jest.fn(async () => ({ error: null })) },
    from: (table: string) => {
      const query = {
        update: (values: unknown) => (mockServer.calls.push(['update', table, values]), query),
        is: (column: string, value: unknown) => (
          mockServer.calls.push(['is', column, value]),
          query
        ),
        eq: (column: string, value: unknown) => (
          mockServer.calls.push(['eq', column, value]),
          query
        ),
        then: (resolve: (r: { error: unknown }) => void) => resolve({ error: mockServer.error }),
      };
      return query;
    },
  }),
}));

function recordingWriter() {
  const calls: unknown[][] = [];
  const writer: BlockWriter = {
    insert: jest.fn(async (...args: unknown[]) => void calls.push(['insert', ...args])),
    remove: jest.fn(async (...args: unknown[]) => void calls.push(['remove', ...args])),
  };
  return { writer, calls };
}

const NOW = Date.parse('2026-11-22T12:00:00Z');
const therapy = {
  id: 'dev-1',
  calendarId: 'cal-1',
  title: 'Therapy',
  location: '12 Quiet Lane',
  notes: 'Talk about the sleep regression',
  url: 'https://clinic.example/visit',
  allDay: false,
  status: 'confirmed',
  startDate: '2026-11-23T15:00:00.000Z',
  endDate: '2026-11-23T16:00:00.000Z',
  attendees: [{ name: 'Dr Rivera', email: 'rivera@clinic.example' }],
};
const block = (id: string, starts_at: string, ends_at: string): BusyBlockRow =>
  ({
    id,
    household_id: 'h1',
    user_id: 'u1',
    starts_at,
    ends_at,
    version: 1,
    created_at: null,
    updated_at: null,
    deleted_at: null,
  }) as BusyBlockRow;

const run = (writer: BlockWriter, over = {}) => ({
  householdId: 'h1',
  userId: 'u1',
  calendarIds: ['cal-1'],
  mine: [] as BusyBlockRow[],
  writer,
  config: DEFAULT_BUSY_TIMES,
  now: NOW,
  ...over,
});

beforeEach(() => {
  mockStore.clear();
  mockServer.calls = [];
  mockServer.error = null;
  mockDeviceEvents = [therapy];
  jest.clearAllMocks();
});

describe('sharing busy times (C-05.3, FR2-DEV-4)', () => {
  it("never lets a device event's title, place or notes reach the outbox (acceptance)", async () => {
    const { writer, calls } = recordingWriter();
    await refreshBusyTimes(run(writer));
    expect(calls).toEqual([
      [
        'insert',
        'busy_blocks',
        'block-1',
        {
          user_id: 'u1',
          starts_at: '2026-11-23T15:00:00.000Z',
          ends_at: '2026-11-23T16:00:00.000Z',
        },
      ],
    ]);
    const written = JSON.stringify(calls);
    for (const secret of ['Therapy', 'Quiet Lane', 'sleep', 'clinic', 'Rivera']) {
      expect(written).not.toContain(secret);
    }
  });

  it('reads the chosen calendars for the next 14 days only', async () => {
    const { writer } = recordingWriter();
    await refreshBusyTimes(run(writer));
    expect(mockListEvents).toHaveBeenCalledWith(
      ['cal-1'],
      new Date(NOW),
      new Date(NOW + 14 * 24 * 60 * 60 * 1000),
    );
  });

  it('skips cancelled events, all-day events and our own copies', async () => {
    mockStore.set(
      'calendar.device.copies',
      JSON.stringify({
        householdId: 'h1',
        calendarId: 'own',
        own: true,
        copies: { 'e1:2026-11-24': { id: 'copy-1', hash: '' } },
      }),
    );
    mockDeviceEvents = [
      { ...therapy, id: 'cancelled', status: 'canceled' },
      { ...therapy, id: 'holiday', allDay: true },
      { ...therapy, id: 'copy-1' },
    ];
    const { writer, calls } = recordingWriter();
    await refreshBusyTimes(run(writer, { calendarIds: ['cal-1', 'own'] }));
    expect(calls).toEqual([]);
    expect(mockListEvents).toHaveBeenCalledWith(['cal-1'], expect.any(Date), expect.any(Date));
  });

  it('refreshes at most every 15 minutes, unless the calendars change (FR2-DEV-5)', async () => {
    const { writer } = recordingWriter();
    expect(await refreshBusyTimes(run(writer))).toBe(true);
    expect(await refreshBusyTimes(run(writer, { now: NOW + 14 * 60_000 }))).toBe(false);
    expect(
      await refreshBusyTimes(run(writer, { now: NOW + 14 * 60_000, calendarIds: ['cal-2'] })),
    ).toBe(true);
    expect(
      await refreshBusyTimes(run(writer, { now: NOW + 30 * 60_000, calendarIds: ['cal-2'] })),
    ).toBe(true);
  });

  it('replaces moved blocks and leaves past ones alone', async () => {
    const { writer, calls } = recordingWriter();
    await refreshBusyTimes(
      run(writer, {
        mine: [
          block('same', '2026-11-23T15:00:00Z', '2026-11-23T16:00:00Z'),
          block('moved', '2026-11-24T09:00:00Z', '2026-11-24T10:00:00Z'),
          block('past', '2026-11-21T09:00:00Z', '2026-11-21T10:00:00Z'),
        ],
      }),
    );
    expect(calls).toEqual([['remove', 'busy_blocks', 'moved']]);
  });

  it('deletes the member blocks on the server at once when turned off (acceptance)', async () => {
    const { writer, calls } = recordingWriter();
    await stopBusyTimes(
      'h1',
      [block('b1', '2026-11-23T15:00:00Z', '2026-11-23T16:00:00Z')],
      writer,
    );
    expect(mockServer.calls).toEqual([
      ['update', 'busy_blocks', { deleted_at: expect.any(String) }],
      ['is', 'deleted_at', null],
      ['eq', 'household_id', 'h1'],
    ]);
    expect(calls).toEqual([['remove', 'busy_blocks', 'b1']]);
  });

  it('still deletes them through the sync layer when offline', async () => {
    mockServer.error = new Error('offline');
    const { writer, calls } = recordingWriter();
    await stopBusyTimes(
      'h1',
      [block('b1', '2026-11-23T15:00:00Z', '2026-11-23T16:00:00Z')],
      writer,
    );
    expect(calls).toEqual([['remove', 'busy_blocks', 'b1']]);
  });

  it('deletes them on sign-out only if this device shared some (FR2-PRIV-4)', async () => {
    await signOut();
    expect(mockServer.calls).toEqual([]);
    const { writer } = recordingWriter();
    await refreshBusyTimes(run(writer));
    await signOut();
    expect(mockServer.calls).toEqual([
      ['update', 'busy_blocks', { deleted_at: expect.any(String) }],
      ['is', 'deleted_at', null],
      ['eq', 'household_id', 'h1'],
    ]);
  });
});
