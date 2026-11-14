import { portionId } from '@/features/planner/tables';

const ENTRY = '3f2a1c4e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const PERSON = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('portionId (P-01.1)', () => {
  it('is the same on every device for the same entry and person', () => {
    expect(portionId(ENTRY, PERSON)).toBe(portionId(ENTRY, PERSON));
  });

  it('is a valid version 8 UUID', () => {
    expect(portionId(ENTRY, PERSON)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('differs per person and per entry, and when the two are swapped', () => {
    const other = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const ids = new Set([
      portionId(ENTRY, PERSON),
      portionId(ENTRY, other),
      portionId(other, PERSON),
      portionId(PERSON, ENTRY),
    ]);
    expect(ids.size).toBe(4);
  });

  it('refuses anything that is not a UUID', () => {
    expect(() => portionId('entry', PERSON)).toThrow();
  });
});
