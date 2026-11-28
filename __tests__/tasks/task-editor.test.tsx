import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useTaskEditor } from '@/features/tasks/use-task-editor';

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
jest.mock('@/features/household/members', () => ({
  fetchMembers: async () => [
    { userId: 'me', role: 'parent', joinedAt: '', displayName: 'Sam' },
    { userId: 'partner', role: 'parent', joinedAt: '', displayName: 'Alex' },
    { userId: 'nanny', role: 'caregiver', joinedAt: '', displayName: 'Jo' },
  ],
}));
let mockPremium = false;
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ isPremium: mockPremium }),
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Harness({ isParent = true }: { isParent?: boolean }) {
  const editor = useTaskEditor({
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

beforeEach(() => {
  mockInsert.mockClear();
  mockTrack.mockClear();
  mockPremium = false;
});

describe('S-45 task editor (FR3-TASK-2)', () => {
  it('adds a task in 2 taps plus typing, with only fixed values in task_created', async () => {
    const view = await show();
    await fireEvent.press(screen.getByTestId('open'));
    expect(screen.getByTestId('task-title').props.autoFocus).toBe(true);
    await fireEvent.changeText(screen.getByTestId('task-title'), 'Book the car service');
    await act(async () => fireEvent.press(screen.getByTestId('task-save')));
    expect(mockInsert).toHaveBeenCalledWith(
      'tasks',
      expect.any(String),
      expect.objectContaining({
        title: 'Book the car service',
        due_date: null,
        assignee_user_id: null,
      }),
    );
    expect(mockTrack).toHaveBeenCalledWith('task_created', {
      source: 'manual',
      has_due: false,
      has_time: false,
      assignee_role: 'none',
      shared: false,
      repeats: false,
      reminder: false,
    });
    expect(screen.queryByTestId('task-title')).toBeNull();
    await view.unmount();
  });

  it('assigns the partner with a due date and a reminder', async () => {
    const view = await show();
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('task-title'), 'Renew the passport');
    await fireEvent.press(screen.getByTestId('task-due-date'));
    await fireEvent.press(screen.getByTestId('task-reminder-morning'));
    await fireEvent.press(await screen.findByTestId('task-assignee-0'));
    await act(async () => fireEvent.press(screen.getByTestId('task-save')));
    expect(mockInsert).toHaveBeenCalledWith(
      'tasks',
      expect.any(String),
      expect.objectContaining({ assignee_user_id: 'partner', reminder: 'reminder.morning' }),
    );
    expect(mockTrack).toHaveBeenCalledWith(
      'task_created',
      expect.objectContaining({ has_due: true, assignee_role: 'parent', reminder: true }),
    );
    await view.unmount();
  });

  it('hints to keep health details out (FR3-PRIV-3), and shows sharing to parents on Premium only', async () => {
    const save = async (title: string) => {
      await fireEvent.changeText(screen.getByTestId('task-title'), title);
      await act(async () => fireEvent.press(screen.getByTestId('task-save')));
      await waitFor(() => expect(screen.queryByTestId('task-title')).toBeNull());
    };
    const view = await show();
    await fireEvent.press(screen.getByTestId('open'));
    expect(screen.getByTestId('task-privacy-hint')).toHaveTextContent(/health details/);
    expect(screen.queryByTestId('task-shared')).toBeNull();
    // Only parents are assignable on Free.
    expect(screen.queryByTestId('task-assignee-1')).toBeNull();
    await save('Free');
    await view.unmount();
    mockPremium = true;
    const premium = await show();
    await fireEvent.press(screen.getByTestId('open'));
    expect(screen.getByTestId('task-shared')).toBeOnTheScreen();
    expect(screen.getByTestId('task-assignee-1')).toBeOnTheScreen();
    await save('Premium');
    await premium.unmount();
  });

  it("assigns a helper's task to themself and says it's shared", async () => {
    mockPremium = true;
    const view = await show(false);
    await fireEvent.press(screen.getByTestId('open'));
    expect(screen.getByTestId('task-shared-always')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('task-title'), 'Out of nappy cream');
    await act(async () => fireEvent.press(screen.getByTestId('task-save')));
    expect(mockInsert).toHaveBeenCalledWith(
      'tasks',
      expect.any(String),
      expect.objectContaining({ assignee_user_id: 'me', shared: true }),
    );
    await view.unmount();
  });

  it('keeps the open sheet and its text when the app is killed (NFR-A11Y-8)', async () => {
    const first = await show();
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('task-title'), 'Half typed');
    await first.unmount();
    const second = await show();
    expect(screen.getByTestId('task-title').props.value).toBe('Half typed');
    await second.unmount();
  });
});
