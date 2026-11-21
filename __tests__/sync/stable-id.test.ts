import { stableId } from '@/lib/sync/stable-id';

const EVENT = '3f2a1c4e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';

describe('stableId (C-01.2, R2-CAL-2)', () => {
  it('is the same on every call for the same parts', () => {
    expect(stableId('event_exception', EVENT, '2026-12-07')).toBe(
      stableId('event_exception', EVENT, '2026-12-07'),
    );
  });

  it('is pinned, so devices on different app versions agree', () => {
    expect(stableId('event_exception', EVENT, '2026-12-07')).toMatchInlineSnapshot(
      `"33ef2c71-2208-870c-bf78-e4a955d7da0e"`,
    );
  });

  it('is a valid version 8 UUID', () => {
    expect(stableId('event_exception', EVENT, '2026-12-07')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('differs per kind, per part and when parts are regrouped', () => {
    const ids = new Set([
      stableId('event_exception', EVENT, '2026-12-07'),
      stableId('event_exception', EVENT, '2026-12-14'),
      stableId('busy_day_override', EVENT, '2026-12-07'),
      stableId('ab', 'c'),
      stableId('a', 'bc'),
    ]);
    expect(ids.size).toBe(5);
  });

  it('spreads a year of dates without collisions', () => {
    const ids = new Set<string>();
    for (let day = 0; day < 366; day++) {
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      ids.add(stableId('event_exception', EVENT, date));
    }
    expect(ids.size).toBe(366);
  });

  it('refuses empty parts or a kind alone', () => {
    expect(() => stableId('event_exception')).toThrow();
    expect(() => stableId('event_exception', '')).toThrow();
  });
});
