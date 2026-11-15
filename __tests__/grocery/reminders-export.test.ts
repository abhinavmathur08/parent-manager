import { buildExportDocument } from '@/features/grocery/export/document';
import { exportToReminders, RemindersDenied } from '@/features/grocery/export/reminders';
import type { ListRowView, ListView } from '@/features/grocery/view';
import { i18n } from '@/i18n';

type Reminder = {
  id: string;
  url?: string;
  title?: string;
  notes?: string;
  completed?: boolean;
  update: jest.Mock;
};

const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStore.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockStore.set(key, value),
  },
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string, { queryParams }: { queryParams: { item: string } }) =>
    `parentmanager://${path}?item=${queryParams.item}`,
}));

let mockPermission = { granted: true, canAskAgain: true };
let mockAnswer = { granted: true, canAskAgain: false };
const mockRequest = jest.fn(async () => mockAnswer);
let mockLists = new Map<string, { id: string; reminders: Reminder[] }>();
let mockNextId = 0;
const listApi = (list: { id: string; reminders: Reminder[] }) => ({
  id: list.id,
  listReminders: async () => list.reminders,
  createReminder: async (details: Partial<Reminder>) => {
    const created: Reminder = { id: `r${++mockNextId}`, ...details, update: jest.fn() };
    created.update.mockImplementation(async (change: Partial<Reminder>) =>
      Object.assign(created, change),
    );
    list.reminders.push(created);
    return created;
  },
});
const mockCreateCalendar = jest.fn(async (_details: unknown) => {
  const list = { id: `list${++mockNextId}`, reminders: [] };
  mockLists.set(list.id, list);
  return listApi(list);
});
jest.mock('expo-calendar', () => ({
  EntityTypes: { REMINDER: 'reminder' },
  getRemindersPermissions: async () => mockPermission,
  requestRemindersPermissions: () => mockRequest(),
  createCalendar: (details: unknown) => mockCreateCalendar(details),
  ExpoCalendar: {
    get: async (id: string) => {
      const list = mockLists.get(id);
      if (!list) throw new Error('Calendar no longer exists');
      return listApi(list);
    },
  },
}));

const t = i18n.getFixedT('en-US');
const row = (id: string, over: Partial<ListRowView> = {}): ListRowView => ({
  id,
  name: id,
  quantity: null,
  meals: 0,
  origin: 'plan',
  planChanged: false,
  checked: false,
  checkedBy: null,
  sectionId: 'section.produce',
  allergens: [],
  ...over,
});
const doc = (view: ListView) =>
  buildExportDocument({ view, weekStart: '2026-11-15', includeChecked: false, locale: 'en-US', t });
const remindersIn = () => [...mockLists.values()].flatMap((l) => l.reminders);

beforeEach(() => {
  mockStore.clear();
  mockLists = new Map();
  mockNextId = 0;
  mockPermission = { granted: true, canAskAgain: true };
  mockAnswer = { granted: true, canAskAgain: false };
  mockRequest.mockClear();
  mockCreateCalendar.mockClear();
  mockTrack.mockClear();
});

describe('exportToReminders (FR-EXP-3, FR-EXP-5)', () => {
  const first: ListView = {
    sections: [{ sectionId: 'section.produce', rows: [row('carrots'), row('onions')] }],
    cart: [],
    total: 2,
  };

  it('creates the week list once and updates it on re-export, never duplicating', async () => {
    await exportToReminders('hh', doc(first), 'Groceries, Nov 15 – Nov 21');
    expect(mockCreateCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Groceries, Nov 15 – Nov 21', entityType: 'reminder' }),
    );
    expect(remindersIn().map((r) => [r.title, r.notes, r.url])).toEqual([
      ['carrots', 'Produce', 'parentmanager://list?item=carrots'],
      ['onions', 'Produce', 'parentmanager://list?item=onions'],
    ]);

    const second: ListView = {
      sections: [{ sectionId: 'section.produce', rows: [row('apples'), row('carrots')] }],
      cart: [row('onions', { checked: true })],
      total: 3,
    };
    await exportToReminders('hh', doc(second), 'Groceries, Nov 15 – Nov 21');
    expect(mockCreateCalendar).toHaveBeenCalledTimes(1);
    expect(remindersIn().map((r) => [r.title, Boolean(r.completed)])).toEqual([
      ['carrots', false],
      ['onions', true],
      ['apples', false],
    ]);
  });

  it('makes a new list when the earlier one was deleted in Reminders', async () => {
    await exportToReminders('hh', doc(first), 'Groceries');
    mockLists.clear();
    await exportToReminders('hh', doc(first), 'Groceries');
    expect(mockCreateCalendar).toHaveBeenCalledTimes(2);
    expect(remindersIn()).toHaveLength(2);
  });

  it('asks for permission the first time and records only the answer', async () => {
    mockPermission = { granted: false, canAskAgain: true };
    await exportToReminders('hh', doc(first), 'Groceries');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('reminders_permission_result', { granted: true });
  });

  it('stops with RemindersDenied when refused, now or earlier', async () => {
    mockPermission = { granted: false, canAskAgain: true };
    mockAnswer = { granted: false, canAskAgain: false };
    await expect(exportToReminders('hh', doc(first), 'Groceries')).rejects.toBeInstanceOf(
      RemindersDenied,
    );
    mockPermission = { granted: false, canAskAgain: false };
    await expect(exportToReminders('hh', doc(first), 'Groceries')).rejects.toBeInstanceOf(
      RemindersDenied,
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockCreateCalendar).not.toHaveBeenCalled();
  });
});
