import {
  canSave,
  draftValues,
  newDraft,
  toggleReminder,
  withKind,
} from '@/features/calendar/editor';

const NY = 'America/New_York';

describe('newDraft (FR2-CAL-2 defaults)', () => {
  it('is an hour-long appointment today at the next whole hour, reminding a day before', () => {
    // 14:20 in New York.
    const draft = newDraft(new Date('2026-11-18T19:20:00Z'), NY, true);
    expect(draft).toMatchObject({
      kind: 'kind.appointment',
      allDay: false,
      date: '2026-11-18',
      startMinutes: 15 * 60,
      lengthMinutes: 60,
      reminders: [1440],
      shared: false,
    });
  });

  it('moves to tomorrow after 23:00', () => {
    const draft = newDraft(new Date('2026-11-19T04:30:00Z'), NY, true);
    expect(draft).toMatchObject({ date: '2026-11-19', startMinutes: 0 });
  });

  it('is always shared for family members and caregivers (C3)', () => {
    const draft = newDraft(new Date('2026-11-18T19:20:00Z'), NY, false);
    expect(draft.shared).toBe(true);
    expect(withKind(draft, 'kind.other').shared).toBe(true);
  });

  it('shares childcare by default until a parent chooses', () => {
    const draft = newDraft(new Date('2026-11-18T19:20:00Z'), NY, true);
    expect(withKind(draft, 'kind.childcare').shared).toBe(true);
    const chosen = { ...withKind(draft, 'kind.childcare'), shared: false, sharedChosen: true };
    expect(withKind(chosen, 'kind.childcare').shared).toBe(false);
  });
});

describe('toggleReminder (FR2-REM-1)', () => {
  const draft = newDraft(new Date('2026-11-18T19:20:00Z'), NY, true);

  it('refuses a second reminder at the Free limit', () => {
    expect(toggleReminder(draft, 60, 1)).toEqual({ draft, overLimit: true });
  });

  it('adds in offset order up to the Premium limit, and removes', () => {
    const added = toggleReminder(draft, 60, 5).draft;
    expect(added.reminders).toEqual([60, 1440]);
    expect(toggleReminder(added, 1440, 5).draft.reminders).toEqual([60]);
  });
});

describe('draftValues (R2-CAL-1)', () => {
  it('stores a timed event as instants on the household clock', () => {
    const draft = {
      ...newDraft(new Date('2026-11-18T19:20:00Z'), NY, true),
      title: '  Pediatrician ',
    };
    expect(draftValues(draft, NY)).toMatchObject({
      title: 'Pediatrician',
      starts_at: '2026-11-18T20:00:00.000Z',
      ends_at: '2026-11-18T21:00:00.000Z',
      start_date: null,
      place: null,
    });
  });

  it('keeps wall time across a daylight-saving change', () => {
    const draft = { ...newDraft(new Date('2026-11-18T19:20:00Z'), NY, true), title: 'Swim' };
    // 10:00 on 2026-06-01 is EDT, UTC-4.
    const values = draftValues({ ...draft, date: '2026-06-01', startMinutes: 600 }, NY);
    expect(values.starts_at).toBe('2026-06-01T14:00:00.000Z');
  });

  it('stores an all-day event as inclusive dates', () => {
    const draft = {
      ...newDraft(new Date(), NY, true),
      title: 'Trip',
      allDay: true,
      date: '2026-12-01',
      days: 3,
    };
    expect(draftValues(draft, NY)).toMatchObject({
      all_day: true,
      starts_at: null,
      start_date: '2026-12-01',
      end_date: '2026-12-03',
    });
  });

  it('needs a title', () => {
    const draft = newDraft(new Date(), NY, true);
    expect(canSave(draft)).toBe(false);
    expect(canSave({ ...draft, title: '   ' })).toBe(false);
    expect(canSave({ ...draft, title: 'Visit' })).toBe(true);
  });
});
