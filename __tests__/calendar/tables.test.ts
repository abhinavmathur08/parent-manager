import {
  BUSY_TABLES,
  CALENDAR_TABLES,
  EVENT_KINDS,
  exceptionId,
  isEventKind,
  overrideId,
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
      'event_exceptions',
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

  it('names the exception for an occurrence the same way on every device (R2-CAL-2)', () => {
    const event = '3f2a1c4e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
    expect(exceptionId(event, '2026-12-07')).toBe(exceptionId(event, '2026-12-07'));
    expect(exceptionId(event, '2026-12-07')).not.toBe(exceptionId(event, '2026-12-14'));
  });

  it('register the busy-day tables, with busy blocks scoped to who may see them (C9)', () => {
    for (const table of BUSY_TABLES) {
      expect(() => validateDefinition(table)).not.toThrow();
    }
    expect(BUSY_TABLES.map((table) => [table.name, 'scoped' in table && table.scoped])).toEqual([
      ['busy_blocks', true],
      ['busy_day_overrides', false],
      ['busy_days', false],
    ]);
  });

  it("names a day's override the same way on every device", () => {
    const household = '3f2a1c4e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
    expect(overrideId(household, '2026-12-02')).toBe(overrideId(household, '2026-12-02'));
    expect(overrideId(household, '2026-12-02')).not.toBe(overrideId(household, '2026-12-03'));
  });
});
