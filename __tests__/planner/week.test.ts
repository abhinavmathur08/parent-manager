import {
  addDays,
  daysBetween,
  inWeek,
  isoWeekday,
  isPlanDate,
  startOfWeek,
  todayIn,
  weekDates,
} from '@/features/planner/week';

describe('planner dates (FR-PLAN-1, spec 3.6)', () => {
  it('starts the week on the household week start', () => {
    // Wednesday 18 November 2026.
    expect(isoWeekday('2026-11-18')).toBe(3);
    expect(startOfWeek('2026-11-18', 7)).toBe('2026-11-15');
    expect(startOfWeek('2026-11-18', 1)).toBe('2026-11-16');
    expect(startOfWeek('2026-11-15', 7)).toBe('2026-11-15');
    expect(startOfWeek('2026-11-15', 1)).toBe('2026-11-09');
  });

  it('crosses month and year boundaries', () => {
    expect(weekDates('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -7)).toBe('2026-02-22');
  });

  it('keeps whole days across daylight-saving changes', () => {
    // US clocks go back on 1 November 2026 and forward on 8 March 2026.
    expect(weekDates('2026-11-01')).toHaveLength(7);
    expect(addDays('2026-10-25', 7)).toBe('2026-11-01');
    expect(addDays('2026-03-08', 7)).toBe('2026-03-15');
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
    // UK and Australian changes.
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-04-05', -1)).toBe('2026-04-04');
  });

  it('says what today is in the household timezone, not the device', () => {
    // 03:30 UTC on 16 November is still the 15th in New York and already the 16th in Sydney.
    const now = new Date('2026-11-16T03:30:00Z');
    expect(todayIn('America/New_York', now)).toBe('2026-11-15');
    expect(todayIn('Australia/Sydney', now)).toBe('2026-11-16');
    expect(todayIn('Europe/London', now)).toBe('2026-11-16');
  });

  it('falls back to the device timezone for an unknown one', () => {
    expect(isPlanDate(todayIn('Not/AZone'))).toBe(true);
    expect(isPlanDate(todayIn(null))).toBe(true);
  });

  it('checks dates', () => {
    expect(isPlanDate('2026-02-30')).toBe(false);
    expect(isPlanDate('2026-2-3')).toBe(false);
    expect(isPlanDate('2026-11-16')).toBe(true);
    expect(inWeek('2026-11-21', '2026-11-15')).toBe(true);
    expect(inWeek('2026-11-22', '2026-11-15')).toBe(false);
    expect(inWeek('2026-11-14', '2026-11-15')).toBe(false);
  });
});
