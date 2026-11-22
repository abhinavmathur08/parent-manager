import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useEventEditor } from '@/features/calendar/use-event-editor';

jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => store.get(key) ?? null,
      setItemSync: (key: string, value: string) => void store.set(key, value),
      removeItemSync: (key: string) => store.delete(key),
      getAllKeys: async () => [...store.keys()],
      removeItem: async (key: string) => void store.delete(key),
    },
  };
});
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
const mockInsert = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncWriter: () => ({ insert: mockInsert }),
}));
jest.mock('@/features/people/data', () => ({
  fetchPeople: async () => [{ id: 'p1', displayName: 'Mia', ageBand: 'baby', allergies: [] }],
}));
jest.mock('@/features/household/members', () => ({
  fetchMembers: async () => [
    { userId: 'me', role: 'parent', joinedAt: '', displayName: 'Sam' },
    { userId: 'partner', role: 'parent', joinedAt: '', displayName: 'Alex' },
  ],
}));
let mockPremium = false;
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ isPremium: mockPremium }),
}));
const mockOpenPremiumSheet = jest.fn();
jest.mock('@/features/subscription/premium-sheet', () => ({
  usePremiumSheet: () => ({ openPremiumSheet: mockOpenPremiumSheet }),
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Harness({ isParent = true }: { isParent?: boolean }) {
  const editor = useEventEditor({
    householdId: 'hh',
    locale: 'en-US',
    timeZone: 'America/New_York',
    userId: 'me',
    isParent,
  });
  return (
    <>
      <Pressable onPress={editor.open} testID="open">
        <Text>open</Text>
      </Pressable>
      {editor.sheet}
    </>
  );
}

const show = async (isParent?: boolean) => {
  const view = await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Harness isParent={isParent} />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
  return view;
};

const save = async () => {
  await fireEvent.press(screen.getByTestId('event-save'));
  await act(async () => undefined);
};

const eventInsert = () => mockInsert.mock.calls.find(([table]) => table === 'events');

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-18T19:20:00Z'), advanceTimers: true });
  mockInsert.mockClear();
  mockTrack.mockClear();
  mockOpenPremiumSheet.mockClear();
  mockPremium = false;
});
afterEach(() => jest.useRealTimers());

describe('S-37 event editor (FR2-CAL-2)', () => {
  it('adds an appointment with a title and the default start in one tap after opening', async () => {
    const view = await show();
    await fireEvent.press(screen.getByTestId('open'));
    expect(screen.getByTestId('event-start-hour')).toHaveTextContent(/3:00\sPM/);
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Pediatrician');
    await save(); // tap 1
    expect(eventInsert()?.[2]).toMatchObject({
      kind: 'kind.appointment',
      title: 'Pediatrician',
      starts_at: '2026-11-18T20:00:00.000Z',
      ends_at: '2026-11-18T21:00:00.000Z',
      shared: false,
      created_by: 'me',
    });
    expect(mockInsert).toHaveBeenCalledWith('event_reminders', expect.any(String), {
      event_id: eventInsert()?.[1],
      offset_minutes: 1440,
    });
    // Fixed values and counts only.
    expect(mockTrack).toHaveBeenCalledWith('event_created', {
      kind: 'appointment',
      all_day: false,
      repeats: false,
      has_people: false,
      has_taking: false,
      shared: false,
      reminders: 1,
    });
    expect(JSON.stringify(mockTrack.mock.calls)).not.toMatch(/Pediatrician/);
    view.unmount();
  });

  it('moves the start to tomorrow and saves in 2 taps', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Visit');
    await fireEvent.press(screen.getByTestId('event-date-increase')); // tap 1
    expect(screen.getByTestId('event-date-value')).toHaveTextContent('Thu, Nov 19');
    await save(); // tap 2
    expect(eventInsert()?.[2]).toMatchObject({ starts_at: '2026-11-19T20:00:00.000Z' });
  });

  it('saves people and taking, and records them as booleans', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Checkup');
    await fireEvent.press(screen.getByTestId('event-for-p1'));
    await fireEvent.press(screen.getByTestId('event-taking-partner'));
    await save();
    expect(eventInsert()?.[2]).toMatchObject({ taking_user_id: 'partner' });
    expect(mockInsert).toHaveBeenCalledWith('event_people', expect.any(String), {
      event_id: eventInsert()?.[1],
      person_id: 'p1',
    });
    expect(mockTrack).toHaveBeenCalledWith(
      'event_created',
      expect.objectContaining({ has_people: true, has_taking: true }),
    );
  });

  it('offers Premium on Free when a second reminder is asked for (FR2-PAY-1)', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.press(screen.getByTestId('event-reminder-60'));
    expect(screen.getByTestId('event-reminders-limit')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('event-reminders-premium'));
    expect(mockOpenPremiumSheet).toHaveBeenCalledWith('reminders', { afterSheet: true });
  });

  it('allows up to 5 reminders on Premium', async () => {
    mockPremium = true;
    await show();
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Scan');
    await fireEvent.press(screen.getByTestId('event-reminder-60'));
    await fireEvent.press(screen.getByTestId('event-reminder-0'));
    expect(screen.queryByTestId('event-reminders-limit')).toBeNull();
    await save();
    expect(mockTrack).toHaveBeenCalledWith(
      'event_created',
      expect.objectContaining({ reminders: 3 }),
    );
  });

  it('creates shared events for caregivers, who only take it themselves', async () => {
    await show(false);
    await fireEvent.press(screen.getByTestId('open'));
    expect(screen.getByTestId('event-shared-always')).toBeTruthy();
    expect(screen.queryByTestId('event-shared')).toBeNull();
    expect(screen.queryByTestId('event-taking-partner')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Nap');
    await save();
    expect(eventInsert()?.[2]).toMatchObject({ shared: true });
  });

  it('keeps the open sheet and its text when the app is killed (NFR-A11Y-8)', async () => {
    const first = await show();
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Daycare tour');
    first.unmount();
    const second = await show();
    expect(screen.getByTestId('event-title').props.value).toBe('Daycare tour');
    // Saving clears the draft.
    await save();
    expect(eventInsert()).toBeTruthy();
    second.unmount();
    await show();
    expect(screen.queryByTestId('event-title')).toBeNull();
  });
});
