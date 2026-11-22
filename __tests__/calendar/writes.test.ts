import { renderHook } from '@testing-library/react-native';

import { newDraft } from '@/features/calendar/editor';
import { kindCode, useCreateEvent } from '@/features/calendar/writes';

let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
const mockInsert = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock('@/lib/sync', () => ({ useSyncWriter: () => ({ insert: mockInsert }) }));
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
