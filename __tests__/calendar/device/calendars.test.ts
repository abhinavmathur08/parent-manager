import { Platform } from 'react-native';

import { eventFields, type CopyDetails } from '@/lib/device-calendar/calendars';

jest.mock('expo-calendar', () => ({}));

const allDay: CopyDetails = {
  allDay: true,
  title: 'Trip',
  location: null,
  notes: 'Family',
  url: 'app://x',
  startDate: '2026-11-27',
  endDate: '2026-11-29',
};

function on(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

describe('device event fields (C-05.2)', () => {
  const original = Platform.OS;
  afterEach(() => on(original as 'ios' | 'android'));

  it('stores all-day copies at UTC midnight with an exclusive end on Android', () => {
    on('android');
    expect(eventFields(allDay)).toEqual({
      title: 'Trip',
      location: null,
      notes: 'Family',
      allDay: true,
      startDate: new Date(Date.UTC(2026, 10, 27)),
      endDate: new Date(Date.UTC(2026, 10, 30)),
      timeZone: 'UTC',
    });
  });

  it('uses local dates, the last day as the end and a link on iOS', () => {
    on('ios');
    expect(eventFields(allDay)).toEqual({
      title: 'Trip',
      location: null,
      notes: 'Family',
      url: 'app://x',
      allDay: true,
      startDate: new Date(2026, 10, 27),
      endDate: new Date(2026, 10, 29),
    });
  });

  it('writes timed copies as instants in the household timezone', () => {
    on('ios');
    const fields = eventFields({
      allDay: false,
      title: 'Swim',
      location: 'Pool',
      notes: 'Activity',
      url: 'app://y',
      startsAt: '2026-11-23T15:00:00.000Z',
      endsAt: '2026-11-23T16:00:00.000Z',
      timeZone: 'America/New_York',
    });
    expect(fields).toMatchObject({
      allDay: false,
      startDate: new Date('2026-11-23T15:00:00.000Z'),
      endDate: new Date('2026-11-23T16:00:00.000Z'),
      timeZone: 'America/New_York',
    });
  });
});
