import { renderHook } from '@testing-library/react-native';

import { draftFromEvent, newDraft } from '@/features/calendar/editor';
import { kindCode, useCreateEvent, useUpdateEvent } from '@/features/calendar/writes';

let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
const mockInsert = jest.fn(async (..._args: unknown[]) => ({}));
const mockUpdate = jest.fn(async (..._args: unknown[]) => ({}));
const mockRemove = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncWriter: () => ({ insert: mockInsert, update: mockUpdate, remove: mockRemove }),
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const NY = 'America/New_York';

describe('useCreateEvent (FR2-CAL-2, FR2-CAL-6)', () => {
  it('writes the event, its people and reminders, and records only fixed values', async () => {
    const { result } = await renderHook(() => useCreateEvent(NY, 'me'));
    const draft = {
      ...newDraft(new Date('2026-11-18T19:20:00Z'), NY, true),
      title: 'Pediatrician',
      place: 'Main St clinic',
      notes: 'Ask about sleep',
      personIds: ['p1'],
      takingUserId: 'me',
    };
    const id = await result.current(draft);
    expect(mockInsert.mock.calls.map(([table]) => table)).toEqual([
      'events',
      'event_people',
      'event_reminders',
    ]);
    expect(mockInsert.mock.calls[0]).toEqual([
      'events',
      id,
      expect.objectContaining({
        title: 'Pediatrician',
        starts_at: '2026-11-18T20:00:00.000Z',
        repeat: null,
        created_by: 'me',
      }),
    ]);
    expect(mockTrack).toHaveBeenCalledWith('event_created', {
      kind: 'appointment',
      all_day: false,
      repeats: false,
      has_people: true,
      has_taking: true,
      shared: false,
      reminders: 1,
    });
    expect(JSON.stringify(mockTrack.mock.calls)).not.toMatch(/Pediatrician|Main St|sleep|p1/);
  });

  it('names kinds by their fixed code', () => {
    expect(kindCode('kind.childcare')).toBe('childcare');
  });
});

describe('useUpdateEvent (S-37 from S-38)', () => {
  const base = {
    household_id: 'hh',
    version: 1,
    created_at: null,
    updated_at: null,
    deleted_at: null,
  };
  const event = {
    ...base,
    id: 'e1',
    kind: 'kind.appointment' as const,
    title: 'Visit',
    all_day: false,
    starts_at: '2026-11-24T15:00:00Z',
    ends_at: '2026-11-24T16:30:00Z',
    start_date: null,
    end_date: null,
    place: null,
    notes: null,
    taking_user_id: null,
    shared: true,
    repeat: null,
    created_by: 'me',
    updated_by: 'me',
  };
  const children = {
    people: [{ ...base, id: 'ep1', event_id: 'e1', person_id: 'p1' }],
    reminders: [{ ...base, id: 'r1', event_id: 'e1', offset_minutes: 1440 as const }],
  };

  it('reads an event back into the same draft', () => {
    expect(draftFromEvent(event, ['p1'], [1440], NY)).toMatchObject({
      title: 'Visit',
      date: '2026-11-24',
      startMinutes: 600,
      lengthMinutes: 90,
      personIds: ['p1'],
      reminders: [1440],
      shared: true,
    });
  });

  it('saves the columns and swaps only the people and reminders that changed', async () => {
    mockInsert.mockClear();
    mockTrack.mockClear();
    const { result } = await renderHook(() => useUpdateEvent(NY, 'me'));
    const draft = {
      ...draftFromEvent(event, ['p1'], [1440], NY),
      personIds: ['p2'],
      reminders: [1440, 60] as (0 | 15 | 60 | 1440 | 2880)[],
    };
    await result.current(event, draft, children);
    expect(mockUpdate).toHaveBeenCalledWith(
      'events',
      'e1',
      expect.objectContaining({ title: 'Visit', updated_by: 'me' }),
    );
    expect(mockRemove).toHaveBeenCalledWith('event_people', 'ep1');
    expect(mockRemove).not.toHaveBeenCalledWith('event_reminders', 'r1');
    expect(mockInsert.mock.calls.map(([table, , values]) => [table, values])).toEqual([
      ['event_people', { event_id: 'e1', person_id: 'p2' }],
      ['event_reminders', { event_id: 'e1', offset_minutes: 60 }],
    ]);
    expect(mockTrack).toHaveBeenCalledWith('event_updated', { kind: 'appointment', scope: 'all' });
  });
});
