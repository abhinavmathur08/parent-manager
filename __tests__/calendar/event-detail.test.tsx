import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { EventDetailScreen } from '@/features/calendar/event-detail-screen';
import { eventPermissions } from '@/features/calendar/permissions';
import type { MemberRole } from '@/features/household/invitations';

let mockRows: Record<string, unknown[]> = {};
const mockUpdate = jest.fn(async (..._args: unknown[]) => ({}));
const mockRemove = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: jest.fn(), update: mockUpdate, remove: mockRemove }),
}));
jest.mock('@/features/people/data', () => ({
  fetchPeople: async () => [{ id: 'p1', displayName: 'Mia', ageBand: 'baby', allergies: [] }],
}));
jest.mock('@/features/household/members', () => ({
  fetchMembers: async () => [
    { userId: 'parent', role: 'parent', joinedAt: '', displayName: 'Sam' },
    { userId: 'carer', role: 'caregiver', joinedAt: '', displayName: 'Jo' },
  ],
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const event = (over: Record<string, unknown> = {}) => ({
  ...base,
  id: 'e1',
  kind: 'kind.appointment',
  title: 'Pediatrician',
  all_day: false,
  starts_at: '2026-11-24T15:00:00Z',
  ends_at: '2026-11-24T16:00:00Z',
  start_date: null,
  end_date: null,
  place: 'Main St clinic',
  notes: 'Bring the red book',
  taking_user_id: null,
  shared: true,
  repeat: null,
  created_by: 'parent',
  updated_by: 'parent',
  ...over,
});

const onBack = jest.fn();
const show = async (role: MemberRole, userId: string) => {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <EventDetailScreen
        eventId="e1"
        date="2026-11-24"
        household={{ id: 'hh', locale: 'en-US', timeZone: 'America/New_York' }}
        role={role}
        userId={userId}
        onBack={onBack}
      />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z'), advanceTimers: true });
  mockRows = {
    events: [event()],
    event_people: [{ ...base, id: 'ep1', event_id: 'e1', person_id: 'p1' }],
    event_reminders: [{ ...base, id: 'r1', event_id: 'e1', offset_minutes: 1440 }],
  };
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

describe('S-38 event detail (FR2-CAL-7)', () => {
  it('shows kind, time, for, taking, place, notes, reminders and who changed it', async () => {
    await show('parent', 'parent');
    expect(screen.getByTestId('event-detail-when')).toHaveTextContent(
      /Tuesday, November 24, 10:00\sAM – 11:00\sAM/,
    );
    expect(screen.getByTestId('event-detail-for')).toHaveTextContent(/Mia/);
    expect(screen.getByTestId('event-detail-taking')).toHaveTextContent(/Nobody yet/);
    expect(screen.getByTestId('event-detail-place')).toHaveTextContent(/Main St clinic/);
    expect(screen.getByTestId('event-detail-notes')).toHaveTextContent(/Bring the red book/);
    expect(screen.getByTestId('event-detail-reminders')).toHaveTextContent(/1 day before/);
    expect(screen.getByTestId('event-detail-changed-by')).toHaveTextContent(/Last changed by You/);
  });

  it('lets a parent unshare and records only the new value', async () => {
    await show('parent', 'parent');
    await fireEvent(screen.getByTestId('event-share'), 'valueChange', false);
    await act(async () => undefined);
    expect(mockUpdate).toHaveBeenCalledWith('events', 'e1', {
      shared: false,
      updated_by: 'parent',
    });
    expect(mockTrack).toHaveBeenCalledWith('event_shared', { shared: false });
  });
});

describe('taking and caregivers (C6, spec section 2)', () => {
  it("lets a caregiver take a parent's shared event, but not edit, delete or share it", async () => {
    await show('caregiver', 'carer');
    expect(screen.queryByTestId('event-delete')).toBeNull();
    expect(screen.queryByTestId('event-share')).toBeNull();
    await fireEvent.press(screen.getByTestId('event-take'));
    await act(async () => undefined);
    expect(mockUpdate).toHaveBeenCalledWith('events', 'e1', {
      taking_user_id: 'carer',
      updated_by: 'carer',
    });
  });

  it('lets the taking caregiver step back', async () => {
    mockRows.events = [event({ taking_user_id: 'carer' })];
    await show('caregiver', 'carer');
    expect(screen.getByTestId('event-detail-taking')).toHaveTextContent(/You/);
    await fireEvent.press(screen.getByTestId('event-step-back'));
    await act(async () => undefined);
    expect(mockUpdate).toHaveBeenCalledWith('events', 'e1', {
      taking_user_id: null,
      updated_by: 'carer',
    });
  });

  it('lets a caregiver delete the shared events they created', async () => {
    mockRows.events = [event({ created_by: 'carer' })];
    await show('caregiver', 'carer');
    expect(screen.getByTestId('event-delete')).toBeTruthy();
    expect(screen.queryByTestId('event-share')).toBeNull();
  });

  it('matches the server rules', () => {
    const shared = { created_by: 'parent', shared: true, taking_user_id: null };
    expect(eventPermissions(shared, 'caregiver', 'carer')).toEqual({
      canEdit: false,
      canShare: false,
      canTake: true,
      canAssign: false,
    });
    expect(eventPermissions({ ...shared, created_by: 'carer' }, 'family', 'carer').canEdit).toBe(
      true,
    );
    // Unshared, a non-parent's own event isn't theirs to edit any more (can_edit_event).
    expect(
      eventPermissions({ ...shared, created_by: 'carer', shared: false }, 'family', 'carer')
        .canEdit,
    ).toBe(false);
    expect(eventPermissions(shared, 'parent', 'parent').canShare).toBe(true);
  });
});

describe('delete with undo (FR2-CAL-8, NFR-REL-5)', () => {
  it('holds the delete for 5 seconds, and undo brings the event back', async () => {
    await show('parent', 'parent');
    await fireEvent.press(screen.getByTestId('event-delete'));
    expect(screen.getByTestId('event-undo')).toBeTruthy();
    expect(screen.queryByTestId('event-detail-when')).toBeNull();
    await fireEvent.press(screen.getByText('Undo'));
    expect(screen.getByTestId('event-detail-when')).toBeTruthy();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('deletes after the undo bar goes and returns to the calendar', async () => {
    await show('parent', 'parent');
    await fireEvent.press(screen.getByTestId('event-delete'));
    await act(async () => {
      jest.advanceTimersByTime(5100);
    });
    expect(mockRemove).toHaveBeenCalledWith('events', 'e1');
    expect(mockTrack).toHaveBeenCalledWith('event_deleted', { kind: 'appointment', scope: 'all' });
    expect(onBack).toHaveBeenCalled();
  });
});
