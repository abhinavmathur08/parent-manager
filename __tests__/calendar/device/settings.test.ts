import { signOut } from '@/features/auth/sign-out';
import {
  DEFAULT_DEVICE_SETTINGS,
  parseDeviceSettings,
  readDeviceSettings,
  writeDeviceSettings,
} from '@/features/calendar/device/settings';

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
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { signOut: jest.fn(async () => ({ error: null })) } }),
}));

beforeEach(() => mockStore.clear());

describe('device calendar settings (S-39)', () => {
  it('starts with every device feature off (FR2-DEV-1)', () => {
    expect(readDeviceSettings('h1')).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(DEFAULT_DEVICE_SETTINGS).toMatchObject({
      copy: false,
      busy: false,
      includeMeals: false,
    });
  });

  it('keeps settings for the household they were made in only', () => {
    writeDeviceSettings('h1', { ...DEFAULT_DEVICE_SETTINGS, copy: true });
    expect(readDeviceSettings('h1').copy).toBe(true);
    expect(readDeviceSettings('h2')).toEqual(DEFAULT_DEVICE_SETTINGS);
  });

  it('falls back to the defaults for malformed values', () => {
    expect(parseDeviceSettings(null)).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(
      parseDeviceSettings({ copy: 'yes', busy: true, busyCalendars: ['a', 3], copyTarget: 7 }),
    ).toEqual({ ...DEFAULT_DEVICE_SETTINGS, busy: true, busyCalendars: ['a'] });
    mockStore.set('calendar.device', '{not json');
    expect(readDeviceSettings('h1')).toEqual(DEFAULT_DEVICE_SETTINGS);
  });

  it('forgets everything on sign-out, which stops busy times (FR2-PRIV-4)', async () => {
    writeDeviceSettings('h1', { ...DEFAULT_DEVICE_SETTINGS, busy: true, busyCalendars: ['c1'] });
    await signOut();
    expect(readDeviceSettings('h1')).toEqual(DEFAULT_DEVICE_SETTINGS);
  });
});
