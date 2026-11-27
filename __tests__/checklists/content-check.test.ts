const { validate } = require('../../scripts/checklist-content.js');

type Item = { id: string; regions?: string[]; dueOffsetDays: number | null; review?: string[] };

function content(items: Item[], regions = ['US', 'GB']) {
  return {
    templates: [{ id: 'checklist.newborn.test', stage: 'infant_0_6m', regions, items }],
  };
}

function locales(us: Record<string, string>, gb: Record<string, string>) {
  return {
    'en-US': { checklist: { newborn: { test: 'Test' } }, checklist_item: { newborn: us } },
    'en-GB': { checklist: { newborn: { test: 'Test' } }, checklist_item: { newborn: gb } },
    'en-AU': {},
  };
}

const ok = { id: 'checklist_item.newborn.plan_meals', dueOffsetDays: 0 };
const okText = { plan_meals: 'Plan easy meals' };

describe('checklist content check (K-01)', () => {
  it('accepts content with text in every locale it is offered in', () => {
    expect(validate(content([ok]), locales(okText, okText))).toEqual([]);
  });

  it('fails on a missing translation', () => {
    expect(validate(content([ok]), locales(okText, {}))).toEqual([
      'checklist_item.newborn.plan_meals: missing en-GB text',
    ]);
  });

  it('fails on an unknown region', () => {
    const errors = validate(content([ok], ['US', 'FR']), locales(okText, {}));
    expect(errors).toContain('checklist.newborn.test: unknown region FR');
    expect(errors).toContain('checklist_item.newborn.plan_meals: unknown region FR');
  });

  it("fails on an item region its template doesn't offer", () => {
    const item = { ...ok, regions: ['AU'] };
    expect(validate(content([item]), locales({}, {}))).toContain(
      "checklist_item.newborn.plan_meals: region AU isn't its template's",
    );
  });

  it('fails on text for a region the item is not offered in, or for an unknown ID', () => {
    const item = { ...ok, regions: ['US'] };
    const errors = validate(content([item]), locales(okText, { ...okText, gone: 'Old item' }));
    expect(errors).toContain(
      "checklist_item.newborn.plan_meals: has en-GB text but isn't offered there",
    );
    expect(errors).toContain('checklist_item.newborn.gone: en-GB text for an unknown ID');
  });

  it.each([
    ['Pack the bag at 36 weeks', 'a number'],
    ['Pack the bag two weeks before', 'a spelled-out timing'],
    ['Pack the bag in the third trimester', 'a pregnancy timing'],
    ['Buy infant paracetamol', 'a medicine'],
    ['Watch for a fever', 'a clinical word'],
    ['You should sterilise bottles', 'advice wording'],
  ])('rejects medical advice wording: %s', (text, what) => {
    const errors = validate(content([ok]), locales({ plan_meals: text }, okText));
    expect(errors.join('\n')).toContain(what);
  });

  it('requires a review flag on items that mention health services or legal admin', () => {
    const health = { plan_meals: 'Book a check-up as your provider advises' };
    expect(validate(content([ok]), locales(health, okText)).join('\n')).toContain(
      'isn\'t flagged "health"',
    );
    const legal = { plan_meals: 'Register the birth' };
    expect(validate(content([ok]), locales(legal, okText)).join('\n')).toContain(
      'isn\'t flagged "legal"',
    );
    const flagged = { ...ok, dueOffsetDays: null, review: ['health'] };
    expect(validate(content([flagged]), locales(health, okText))).toEqual([]);
  });

  it('keeps health items undated, so no clinical schedule is implied (FR3-CHK-8)', () => {
    const item = { ...ok, review: ['health'] };
    expect(validate(content([item]), locales(okText, okText))).toEqual([
      'checklist_item.newborn.plan_meals: a health item has no suggested date (dueOffsetDays null)',
    ]);
  });

  it('checks IDs, stages, flags and offsets', () => {
    const data = {
      templates: [
        {
          id: 'checklist.expecting.test',
          stage: 'expecting',
          regions: ['US'],
          items: [
            { id: 'bad id', dueOffsetDays: 3 },
            { id: 'checklist_item.expecting.a', dueOffsetDays: 1.5, review: ['tax'] },
          ],
        },
        {
          id: 'checklist.other.test',
          stage: 'pregnant',
          regions: ['US'],
          items: [{ id: 'checklist_item.other.b', dueOffsetDays: -1 }],
        },
      ],
    };
    const errors = validate(data, {});
    expect(errors).toEqual([
      'bad id: bad item ID',
      "bad id: an expecting item can't be due after the due month starts",
      'checklist_item.expecting.a: unknown review flag tax',
      'checklist_item.expecting.a: dueOffsetDays must be a whole number or null',
      'checklist.other.test: unknown stage pregnant',
      "checklist_item.other.b: a baby's item can't be due before the checklist starts",
    ]);
  });
});
