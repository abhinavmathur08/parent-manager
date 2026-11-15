import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { messageKey, routeFor, type InboxItem } from '@/features/notifications/inbox';
import { InboxScreen } from '@/features/notifications/inbox-screen';
import { handleResponse, TURN_OFF_ACTION } from '@/features/notifications/notification-responses';
import { DEFAULT_PREFS } from '@/features/notifications/prefs';

let mockItems: InboxItem[] = [];
const mockMarkRead = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/features/notifications/inbox', () => ({
  ...jest.requireActual('@/features/notifications/inbox'),
  fetchInbox: async () => mockItems,
  markRead: (...args: unknown[]) => mockMarkRead(...args),
}));
const mockSavePrefs = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/features/notifications/prefs', () => ({
  ...jest.requireActual('@/features/notifications/prefs'),
  fetchPrefs: async () => jest.requireActual('@/features/notifications/prefs').DEFAULT_PREFS,
  savePrefs: (...args: unknown[]) => mockSavePrefs(...args),
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
const mockNavigate = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: {
      navigate: (...args: unknown[]) => mockNavigate(...args),
      back: jest.fn(),
      replace: jest.fn(),
      canGoBack: () => true,
    },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const item = (over: Partial<InboxItem>): InboxItem => ({
  id: 'n1',
  type: 'list_ready',
  payload: {},
  createdAt: '2026-11-14T18:00:00Z',
  readAt: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockItems = [];
});

describe('inbox items (FR-NOT-8)', () => {
  it('picks the message for each type and household event', () => {
    expect(messageKey(item({ type: 'plan_week' }))).toBe('plan_week');
    expect(messageKey(item({ type: 'household_changes', payload: { event: 'member_left' } }))).toBe(
      'member_left',
    );
    expect(messageKey(item({ type: 'household_changes', payload: { event: 'other' } }))).toBe(
      'member_joined',
    );
  });

  it('opens the related screen', () => {
    expect(routeFor('plan_week')).toBe('/plan');
    expect(routeFor('list_ready')).toBe('/list');
    expect(routeFor('household_changes')).toBe('/household/members');
    expect(routeFor('anything else')).toBeNull();
  });
});

describe('inbox screen (S-24)', () => {
  const renderInbox = async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <InboxScreen />
      </SafeAreaProvider>,
    );
  };

  it('shows an empty state', async () => {
    await renderInbox();
    await waitFor(() => expect(screen.getByTestId('inbox-empty')).toBeTruthy());
    expect(screen.queryByTestId('inbox-mark-all-read')).toBeNull();
  });

  it('lists notifications with read state and no personal details', async () => {
    mockItems = [
      item({ id: 'n1', type: 'list_ready' }),
      item({
        id: 'n2',
        type: 'household_changes',
        payload: { event: 'member_joined' },
        readAt: 'x',
      }),
    ];
    await renderInbox();
    await waitFor(() => expect(screen.getByTestId('inbox-item-0')).toBeTruthy());
    expect(screen.getByText('The grocery list is ready')).toBeTruthy();
    expect(screen.getByText('Someone joined your household')).toBeTruthy();
    expect(screen.getByTestId('inbox-item-0-unread')).toBeTruthy();
    expect(screen.getByTestId('inbox-item-1-read')).toBeTruthy();
  });

  it('marks an item read and opens its screen when tapped', async () => {
    mockItems = [item({ id: 'n1', type: 'list_ready' })];
    await renderInbox();
    await waitFor(() => expect(screen.getByTestId('inbox-item-0')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('inbox-item-0'));
    expect(mockMarkRead).toHaveBeenCalledWith(['n1']);
    expect(mockTrack).toHaveBeenCalledWith('notification_opened', { type: 'list_ready' });
    expect(mockNavigate).toHaveBeenCalledWith('/list');
    expect(screen.getByTestId('inbox-item-0-read')).toBeTruthy();
  });

  it('marks everything read', async () => {
    mockItems = [item({ id: 'n1' }), item({ id: 'n2', type: 'plan_week' })];
    await renderInbox();
    await waitFor(() => expect(screen.getByTestId('inbox-mark-all-read')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('inbox-mark-all-read'));
    expect(mockMarkRead).toHaveBeenCalledWith();
    expect(screen.getByTestId('inbox-item-1-read')).toBeTruthy();
  });
});

describe('notification taps (FR-NOT-7, FR-NOT-8)', () => {
  let counter = 0;
  const response = (
    data: Record<string, unknown>,
    action = 'expo.modules.notifications.actions.DEFAULT',
  ) =>
    ({
      actionIdentifier: action,
      notification: { request: { identifier: `r${counter++}`, content: { data } } },
    }) as unknown as Notifications.NotificationResponse;

  it('marks the push read and opens its screen', async () => {
    await handleResponse(response({ notificationId: 'n9', type: 'plan_week' }), 'u1');
    expect(mockMarkRead).toHaveBeenCalledWith(['n9']);
    expect(mockTrack).toHaveBeenCalledWith('notification_opened', { type: 'plan_week' });
    expect(mockNavigate).toHaveBeenCalledWith('/plan');
  });

  it('handles each response once', async () => {
    const same = response({ notificationId: 'n9', type: 'plan_week' });
    await handleResponse(same, 'u1');
    await handleResponse(same, 'u1');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('turns the type off from the notification', async () => {
    await handleResponse(
      response({ notificationId: 'n9', type: 'list_ready' }, TURN_OFF_ACTION),
      'u1',
    );
    expect(mockSavePrefs).toHaveBeenCalledWith('u1', { ...DEFAULT_PREFS, list_ready: false });
    expect(mockTrack).toHaveBeenCalledWith('notification_type_toggled', {
      type: 'list_ready',
      enabled: false,
      surface: 'notification',
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ignores an unknown type', async () => {
    await handleResponse(response({ type: 'nope' }, TURN_OFF_ACTION), 'u1');
    await handleResponse(response({ type: 'nope' }), 'u1');
    expect(mockSavePrefs).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
