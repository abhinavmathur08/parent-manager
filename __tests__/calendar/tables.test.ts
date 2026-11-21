import {
  CALENDAR_TABLES,
  EVENT_KINDS,
  isEventKind,
  REMINDER_OFFSETS,
} from '@/features/calendar/tables';
import { validateDefinition } from '@/lib/sync/registry';

describe('calendar sync tables (C-01.1)', () => {
  it('are valid sync table definitions', () => {
    for (const table of CALENDAR_TABLES) {
      expect(() => validateDefinition(table)).not.toThrow();
    }
  });

  it('keep the event and its children in separate tables', () => {
    expect(CALENDAR_TABLES.map((table) => table.name)).toEqual([
      'events',
      'event_people',
      'event_reminders',
    ]);
  });

  it('stores kinds as identifiers', () => {
    expect(EVENT_KINDS.every((kind) => kind.startsWith('kind.'))).toBe(true);
    expect(isEventKind('kind.appointment')).toBe(true);
    expect(isEventKind('Appointment')).toBe(false);
  });

  it('offers the five reminder offsets the server accepts', () => {
    expect(REMINDER_OFFSETS).toEqual([0, 15, 60, 1440, 2880]);
  });
});
