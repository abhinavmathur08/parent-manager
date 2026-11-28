import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TasksScreen } from '@/features/tasks/tasks-screen';
import { i18n } from '@/i18n';
import { PSEUDO_LOCALE } from '@/i18n/locale';

let mockRows: Record<string, unknown[]> = {};
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
}));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}));
let mockOnline = true;
jest.mock('@/hooks/use-online', () => ({ useOnline: () => mockOnline }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});
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
const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  household_id: 'hh',
  version: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: null,
  deleted_at: null,
  title: id,
  template_item_id: null,
  notes: null,
  due_date: null,
  due_at: null,
  assignee_user_id: null,
  shared: false,
  reminder: null,
  repeat: null,
  after_done_days: null,
  rotation_user_ids: null,
  source_kind: null,
  source_id: null,
  done: false,
  done_at: null,
  done_by: null,
  created_by: null,
  updated_by: null,
  ...over,
});
const household = { id: 'hh', locale: 'en-US', timezone: 'America/New_York' };
const show = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <TasksScreen household={household} userId="me" />
    </SafeAreaProvider>,
  );

type Node = { props?: Record<string, unknown>; children?: (Node | string)[] | null };
function truncated(node: unknown): Node[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(truncated);
  const { props, children } = node as Node;
  const own = typeof props?.numberOfLines === 'number' ? [node as Node] : [];
  return [...own, ...(children ?? []).flatMap(truncated)];
}

beforeEach(() => {
  // Wednesday 2026-11-18, noon in New York.
  jest.useFakeTimers({ now: new Date('2026-11-18T17:00:00Z'), advanceTimers: true });
  mockRows = {};
  mockOnline = true;
  mockTrack.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('S-44 Tasks (FR3-TASK-1)', () => {
  it('shows the empty state and records tasks_viewed with the filter', async () => {
    await show();
    expect(screen.getByTestId('tasks-empty')).toBeOnTheScreen();
    expect(mockTrack).toHaveBeenCalledWith('tasks_viewed', { filter: 'everyone' });
  });

  it('groups tasks with relative due words in the household timezone (NFR3-L10N-1)', async () => {
    mockRows.tasks = [
      task('Return the books', { due_date: '2026-11-17' }),
      task('Book the car service', { due_date: '2026-11-19', assignee_user_id: 'sam' }),
      task('Call the nursery', { due_at: '2026-11-18T22:30:00Z' }),
      task('Fix the gate'),
    ];
    await show();
    expect(screen.getByTestId('tasks-overdue-0')).toHaveTextContent(/Return the books.*Yesterday/);
    expect(screen.getByTestId('tasks-today-0')).toHaveTextContent(/Call the nursery.*5:30/);
    expect(screen.getByTestId('tasks-upcoming')).toHaveTextContent(/Tomorrow/);
    expect(await screen.findByTestId('tasks-upcoming-0-0')).toHaveTextContent(/For Sam/);
    expect(screen.getByTestId('tasks-anytime-0')).toHaveTextContent('Fix the gate');
  });

  it('filters to mine and to a member, recording each filter', async () => {
    mockRows.tasks = [
      task('Mine', { assignee_user_id: 'me' }),
      task('Theirs', { assignee_user_id: 'sam' }),
    ];
    await show();
    await fireEvent.press(screen.getByTestId('tasks-filter-mine'));
    expect(screen.getByTestId('tasks-anytime-0')).toHaveTextContent(/^Mine.*For you/);
    expect(screen.queryByTestId('tasks-anytime-1')).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith('tasks_viewed', { filter: 'mine' });
    await fireEvent.press(await screen.findByTestId('tasks-filter-member-0'));
    expect(screen.getByTestId('tasks-anytime-0')).toHaveTextContent(/^Theirs/);
    expect(mockTrack).toHaveBeenCalledWith('tasks_viewed', { filter: 'member' });
  });

  it('keeps Done collapsed until asked, and says when everything is done', async () => {
    mockRows.tasks = [task('Done one', { done: true, done_at: '2026-11-18T10:00:00Z' })];
    await show();
    expect(screen.getByTestId('tasks-all-done')).toBeOnTheScreen();
    expect(screen.queryByTestId('tasks-done-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('tasks-done-toggle'));
    expect(screen.getByTestId('tasks-done-0')).toHaveTextContent(/Done one.*Done/);
  });

  it('shows the offline banner', async () => {
    mockOnline = false;
    await show();
    expect(screen.getByTestId('tasks-offline')).toBeOnTheScreen();
  });

  it('never truncates text in the pseudo-locale at the largest size', async () => {
    mockRows.tasks = [task('Pick up the prescription', { due_date: '2026-11-20' })];
    i18n.options.postProcess = ['pseudo'];
    await i18n.changeLanguage(PSEUDO_LOCALE);
    try {
      const { ThemeOverride } =
        jest.requireActual<typeof import('@/hooks/use-theme')>('@/hooks/use-theme');
      await render(
        <SafeAreaProvider initialMetrics={metrics}>
          <ThemeOverride fontScale={2}>
            <TasksScreen household={household} userId="me" />
          </ThemeOverride>
        </SafeAreaProvider>,
      );
      expect(screen.getByTestId('tasks-screen')).toHaveTextContent(/Ţášķš/);
      expect(truncated(screen.toJSON())).toEqual([]);
    } finally {
      i18n.options.postProcess = false;
      await i18n.changeLanguage('en-US');
    }
  });
});
