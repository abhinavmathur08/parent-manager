import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TaskDetailScreen } from '@/features/tasks/task-detail-screen';
import { useTaskDeleteRequests } from '@/features/tasks/task-events';

let mockRows: Record<string, unknown[]> = {};
const mockUpdate = jest.fn(async (..._args: unknown[]) => undefined);
const mockRemove = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ update: mockUpdate, remove: mockRemove }),
}));
jest.mock('@/features/household/members', () => ({
  fetchMembers: async () => [
    { userId: 'me', role: 'parent', displayName: 'Alex' },
    { userId: 'sam', role: 'parent', displayName: 'Sam' },
  ],
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const task = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  household_id: 'hh',
  version: 3,
  created_at: '2026-11-16T15:00:00Z',
  updated_at: '2026-11-17T15:00:00Z',
  deleted_at: null,
  title: 'Renew the passport',
  template_item_id: null,
  notes: 'Photos first',
  due_date: '2026-11-20',
  due_at: null,
  assignee_user_id: 'sam',
  shared: false,
  reminder: 'reminder.morning',
  repeat: null,
  after_done_days: null,
  rotation_user_ids: null,
  source_kind: 'source.event',
  source_id: 'e1',
  done: false,
  done_at: null,
  done_by: null,
  created_by: 'me',
  updated_by: 'sam',
  ...over,
});

const onBack = jest.fn();
const show = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <TaskDetailScreen
        taskId="t1"
        household={{ id: 'hh', locale: 'en-US', timeZone: 'America/New_York' }}
        userId="me"
        isParent
        isPremium={false}
        onBack={onBack}
      />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-18T17:00:00Z'), advanceTimers: true });
  mockRows = { tasks: [task()] };
  mockUpdate.mockClear();
  mockRemove.mockClear();
  mockTrack.mockClear();
  onBack.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('S-46 task detail (FR3-TASK-7)', () => {
  it('shows the due, assignee, reminder, notes, source and who created and changed it', async () => {
    await show();
    expect(screen.getByTestId('task-detail-due')).toHaveTextContent(/Fri, Nov 20/);
    expect(await screen.findByTestId('task-detail-assignee')).toHaveTextContent(/Sam/);
    expect(screen.getByTestId('task-detail-reminder')).toHaveTextContent(/9:00 AM that day/);
    expect(screen.getByTestId('task-detail-notes')).toHaveTextContent('Photos first');
    expect(screen.getByTestId('task-detail-source')).toHaveTextContent(/The calendar/);
    expect(screen.getByTestId('task-detail-history')).toHaveTextContent(
      /Added by You.*Last changed by Sam/,
    );
  });

  it('says who completed it, and a deleted account is a former member (FR3-PRIV-2)', async () => {
    mockRows = { tasks: [task({ done: true, done_at: '2026-11-18T14:00:00Z', done_by: null })] };
    await show();
    expect(screen.getByTestId('task-detail-completed')).toHaveTextContent(
      /Done by A former member, Nov 18, 9:00 AM/,
    );
    await fireEvent.press(screen.getByTestId('task-detail-toggle'));
    expect(mockUpdate).toHaveBeenCalledWith('tasks', 't1', { done: false });
  });

  it('completes it and assigns it from detail', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('task-detail-toggle'));
    expect(mockUpdate).toHaveBeenCalledWith('tasks', 't1', { done: true });
    await fireEvent.press(await screen.findByTestId('task-detail-assignee'));
    await fireEvent.press(screen.getByTestId('task-assign-me'));
    expect(mockUpdate).toHaveBeenCalledWith('tasks', 't1', { assignee_user_id: 'me' });
    expect(mockTrack).toHaveBeenCalledWith('task_assigned', {
      assignee_role: 'self',
      via: 'detail',
    });
  });

  it("hands a delete to the list's undo bar, or writes it when no list is open (FR3-TASK-8)", async () => {
    const asked: string[] = [];
    function List() {
      useTaskDeleteRequests((id) => asked.push(id));
      return null;
    }
    const list = await render(<List />);
    await show();
    await fireEvent.press(screen.getByTestId('task-detail-delete'));
    expect(onBack).toHaveBeenCalled();
    expect(asked).toEqual(['t1']);
    expect(mockRemove).not.toHaveBeenCalled();
    await list.unmount();

    await fireEvent.press(screen.getByTestId('task-detail-delete'));
    await act(async () => undefined);
    expect(mockRemove).toHaveBeenCalledWith('tasks', 't1');
  });

  it('says when the task is gone or not shared', async () => {
    mockRows = { tasks: [] };
    await show();
    expect(screen.getByTestId('task-missing-state')).toBeOnTheScreen();
  });
});
