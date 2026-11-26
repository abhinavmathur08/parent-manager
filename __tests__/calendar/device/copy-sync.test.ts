import { signOut } from '@/features/auth/sign-out';
import type { CopyItem } from '@/features/calendar/device/copy';
import { clearHouseholdData } from '@/features/household/access-lost';
import {
  beforeSignOut,
  hasCopies,
  readCopyState,
  removeCopies,
  removeCopiesAfterAccessLost,
  syncCopies,
  type CopyApi,
  type CopyRun,
} from '@/features/calendar/device/copy-sync';
import {
  DEFAULT_DEVICE_SETTINGS,
  readDeviceSettings,
  writeDeviceSettings,
} from '@/features/calendar/device/settings';
import type { CopyDetails } from '@/lib/device-calendar/calendars';

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
jest.mock('expo-calendar', () => ({}));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { signOut: jest.fn(async () => ({ error: null })) } }),
}));

/** A fake phone: calendars holding events. */
function fakePhone() {
  const calendars = new Map<string, Map<string, CopyDetails>>([['google', new Map()]]);
  let next = 0;
  const api: CopyApi = {
    calendarExists: jest.fn(async (id: string) => calendars.has(id)),
    createAppCalendar: jest.fn(async () => {
      const id = `own-${++next}`;
      calendars.set(id, new Map());
      return id;
    }),
    deleteCalendar: jest.fn(async (id: string) => void calendars.delete(id)),
    putEvent: jest.fn(async (calendarId: string, existingId: string | null, details) => {
      const calendar = calendars.get(calendarId)!;
      const id = existingId && calendar.has(existingId) ? existingId : `ev-${++next}`;
      calendar.set(id, details);
      return id;
    }),
    deleteEvent: jest.fn(async (id: string) => {
      for (const calendar of calendars.values()) calendar.delete(id);
    }),
  };
  return { api, calendars };
}

const details = (title: string, startsAt = '2026-11-23T15:00:00Z'): CopyDetails => ({
  allDay: false,
  title,
  location: null,
  notes: 'Appointment',
  url: 'app://x',
  startsAt,
  endsAt: '2026-11-23T16:00:00Z',
  timeZone: 'America/New_York',
});
const run = (items: CopyItem[], over: Partial<CopyRun> = {}): CopyRun => ({
  householdId: 'h1',
  target: null,
  items,
  calendarTitle: 'Parent Manager',
  calendarColor: '#3F6B4F',
  ...over,
});

const copyOn = (householdId = 'h1') =>
  writeDeviceSettings(householdId, { ...DEFAULT_DEVICE_SETTINGS, copy: true });

beforeEach(() => {
  mockStore.clear();
  copyOn();
});

describe('device copies (C-05.2, FR2-DEV-2)', () => {
  it('makes our own calendar once and writes each copy', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    expect(phone.api.createAppCalendar).toHaveBeenCalledTimes(1);
    expect(phone.api.putEvent).toHaveBeenCalledTimes(1);
    expect([...phone.calendars.get('own-1')!.values()]).toEqual([details('Swim')]);
  });

  it('moves, then removes, a copy as the event changes in the app', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    const id = readCopyState()!.copies.a.id;
    await syncCopies(
      run([{ key: 'a', details: details('Swim', '2026-11-23T17:00:00Z') }]),
      phone.api,
    );
    expect(readCopyState()!.copies.a.id).toBe(id);
    expect(phone.calendars.get('own-1')!.get(id)).toMatchObject({
      startsAt: '2026-11-23T17:00:00Z',
    });
    await syncCopies(run([]), phone.api);
    expect(phone.calendars.get('own-1')!.size).toBe(0);
    expect(readCopyState()!.copies).toEqual({});
  });

  it('writes to a calendar the member picked, and moves the copies when they change it', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    await syncCopies(
      run([{ key: 'a', details: details('Swim') }], { target: 'google' }),
      phone.api,
    );
    expect(phone.calendars.has('own-1')).toBe(false);
    expect(phone.calendars.get('google')!.size).toBe(1);
    expect(readCopyState()).toMatchObject({ calendarId: 'google', own: false });
  });

  it('falls back to our own calendar when the picked one is gone', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }], { target: 'gone' }), phone.api);
    expect(readCopyState()).toMatchObject({ calendarId: 'own-1', own: true });
  });

  it("removes the copies of another household's events first", async () => {
    const phone = fakePhone();
    await syncCopies(
      run([{ key: 'a', details: details('Swim') }], { target: 'google' }),
      phone.api,
    );
    copyOn('h2');
    await syncCopies(run([], { householdId: 'h2', target: 'google' }), phone.api);
    expect(phone.calendars.get('google')!.size).toBe(0);
    expect(readCopyState()!.householdId).toBe('h2');
  });

  it('tries a failed copy again on the next run', async () => {
    const phone = fakePhone();
    const put = phone.api.putEvent as jest.Mock;
    put.mockRejectedValueOnce(new Error('denied'));
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    expect(readCopyState()!.copies).toEqual({});
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    expect(Object.keys(readCopyState()!.copies)).toEqual(['a']);
  });

  it('removes every copy, and our calendar, on request', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    await removeCopies(phone.api);
    expect(phone.calendars.has('own-1')).toBe(false);
    expect(readCopyState()).toBeNull();

    await syncCopies(run([{ key: 'b', details: details('Gym') }], { target: 'google' }), phone.api);
    await removeCopies(phone.api);
    expect(phone.calendars.get('google')!.size).toBe(0);
  });

  it('keeps the copies on sign-out but stops tracking them (FR2-PRIV-4)', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    await signOut();
    expect(readCopyState()).toBeNull();
    expect(phone.calendars.get('own-1')!.size).toBe(1);
  });

  it('writes nothing once copying is turned off', async () => {
    const phone = fakePhone();
    writeDeviceSettings('h1', DEFAULT_DEVICE_SETTINGS);
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    expect(phone.api.createAppCalendar).not.toHaveBeenCalled();
    expect(readCopyState()).toBeNull();
  });

  it('never writes a copy while copies are being removed', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    writeDeviceSettings('h1', DEFAULT_DEVICE_SETTINGS);
    await Promise.all([
      removeCopies(phone.api),
      syncCopies(run([{ key: 'b', details: details('Gym') }]), phone.api),
    ]);
    expect(phone.calendars.size).toBe(1);
    expect(readCopyState()).toBeNull();
  });

  it('stops copying before sign-out, and removes the copies only if asked', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    expect(hasCopies()).toBe(true);
    await beforeSignOut(false, phone.api);
    expect(readDeviceSettings('h1').copy).toBe(false);
    expect(phone.calendars.get('own-1')!.size).toBe(1);

    copyOn();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    await beforeSignOut(true, phone.api);
    expect(phone.calendars.has('own-1')).toBe(false);
    expect(hasCopies()).toBe(false);
  });

  it('removes every copy and stops copying when the member loses access (SR2-M2)', async () => {
    const phone = fakePhone();
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    expect(phone.calendars.get('own-1')!.size).toBe(1);
    await removeCopiesAfterAccessLost(phone.api);
    expect(phone.calendars.has('own-1')).toBe(false);
    expect(readCopyState()).toBeNull();
    expect(readDeviceSettings('h1')).toEqual(DEFAULT_DEVICE_SETTINGS);
    // A run that was still waiting writes nothing.
    await syncCopies(run([{ key: 'a', details: details('Swim') }]), phone.api);
    expect(phone.calendars.size).toBe(1);
  });

  it('deletes the copies from a picked calendar but keeps that calendar (SR2-M2)', async () => {
    const phone = fakePhone();
    await syncCopies(
      run([{ key: 'a', details: details('Swim') }], { target: 'google' }),
      phone.api,
    );
    expect(phone.calendars.get('google')!.size).toBe(1);
    await removeCopiesAfterAccessLost(phone.api);
    expect(phone.calendars.get('google')!.size).toBe(0);
    expect(hasCopies()).toBe(false);
  });

  it('runs when the household reports access lost (SR2-M2)', async () => {
    copyOn();
    // The registered cleanup uses the real device calendar module, so only the state shows.
    mockStore.set(
      'calendar.device.copies',
      JSON.stringify({ householdId: 'h1', calendarId: 'google', own: false, copies: {} }),
    );
    await clearHouseholdData();
    expect(readCopyState()).toBeNull();
    expect(readDeviceSettings('h1').copy).toBe(false);
  });
});
