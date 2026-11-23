import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  messageKey,
  messageValues,
  routeFor,
  type InboxItem,
} from '@/features/notifications/inbox';
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

  it('turns change notifications off from a change push (C-04.2)', async () => {
    await handleResponse(
      response({ notificationId: 'n9', type: 'event_changed' }, TURN_OFF_ACTION),
      'u1',
    );
    expect(mockSavePrefs).toHaveBeenCalledWith('u1', { ...DEFAULT_PREFS, event_changes: false });
  });

  it('opens the event a calendar push is about, marking a prompt as answered from a push', async () => {
    const event = 'eeeeeeee-0000-0000-0000-000000000001';
    await handleResponse(
      response({ notificationId: 'n9', type: 'who_taking', event_id: event, date: '2026-11-25' }),
      'u1',
    );
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/calendar/[id]',
      params: { id: event, date: '2026-11-25', prompt: 'push' },
    });
  });
});

describe('calendar notifications in the inbox (C-04.2)', () => {
  it('words each change, falling back for one it does not know', () => {
    for (const change of ['created', 'moved', 'cancelled']) {
      expect(messageKey(item({ type: 'event_changed', payload: { change } }))).toBe(
        `event_${change}`,
      );
    }
    expect(messageKey(item({ type: 'event_changed', payload: { change: 'x' } }))).toBe(
      'event_changed',
    );
    expect(messageKey(item({ type: 'who_taking' }))).toBe('who_taking');
  });

  it('opens the event, and the calendar when the event is missing', () => {
    const payload = {
      event_id: 'e1',
      change: 'moved',
      kind: 'kind.appointment',
      date: '2026-11-25',
    };
    expect(routeFor('event_changed', payload, 'inbox')).toEqual({
      pathname: '/calendar/[id]',
      params: { id: 'e1', date: '2026-11-25' },
    });
    expect(routeFor('who_taking', payload, 'inbox')).toEqual({
      pathname: '/calendar/[id]',
      params: { id: 'e1', date: '2026-11-25', prompt: 'inbox' },
    });
    expect(routeFor('event_changed', {})).toBe('/calendar');
  });
});

describe('document expiry reminders in the inbox (V-07)', () => {
  const t = (key: string) => `<${key}>`;

  it('names the category and date, from IDs and a date only', () => {
    const entry = item({
      type: 'document_expiring',
      payload: { category: 'doc.insurance', expires_on: '2026-12-22' },
    });
    expect(messageKey(entry)).toBe('document_expiring_category');
    expect(messageValues(entry, t, 'en-US')).toEqual({
      category: '<notifications.documentCategory.insurance>',
      date: 'December 22, 2026',
    });
    expect(routeFor('document_expiring', entry.payload, 'inbox')).toBe('/household');
  });

  it('says "a document" when there is no category it may name (FR2-DOC-11)', () => {
    for (const payload of [
      { expires_on: '2026-12-22' },
      { category: 'doc.medical', expires_on: '2026-12-22' },
    ]) {
      const entry = item({ type: 'document_expiring', payload });
      expect(messageKey(entry)).toBe('document_expiring_any');
      expect(messageValues(entry, t, 'en-US')).toEqual({ date: 'December 22, 2026' });
    }
  });

  it('turns expiry reminders off from the push', async () => {
    await handleResponse(
      {
        actionIdentifier: TURN_OFF_ACTION,
        notification: {
          request: { identifier: 'doc-1', content: { data: { type: 'document_expiring' } } },
        },
      } as unknown as Notifications.NotificationResponse,
      'u1',
    );
    expect(mockSavePrefs).toHaveBeenCalledWith('u1', { ...DEFAULT_PREFS, document_expiry: false });
  });

  it('other messages have no values', () => {
    expect(messageValues(item({ type: 'list_ready' }), t, 'en-US')).toEqual({});
  });
});
