import { buildExportDocument } from '@/features/grocery/export/document';
import {
  itemIdFromUrl,
  planReminders,
  type ExistingReminder,
} from '@/features/grocery/export/reminders-plan';
import type { ListRowView, ListView } from '@/features/grocery/view';
import { i18n } from '@/i18n';

const t = i18n.getFixedT('en-US');
const row = (id: string, over: Partial<ListRowView> = {}): ListRowView => ({
  id,
  name: id,
  quantity: null,
  meals: 0,
  origin: 'plan',
  planChanged: false,
  checked: false,
  sectionId: 'section.produce',
  allergens: [],
  ...over,
});
const doc = (view: ListView, includeChecked = false) =>
  buildExportDocument({ view, weekStart: '2026-11-15', includeChecked, locale: 'en-US', t });
const urlFor = (id: string) => `parentmanager://list?item=${id}`;
const reminder = (id: string, itemId: string | null, over: Partial<ExistingReminder> = {}) => ({
  id,
  url: itemId ? urlFor(itemId) : null,
  title: itemId,
  notes: 'Produce',
  completed: false,
  ...over,
});

const first: ListView = {
  sections: [
    { sectionId: 'section.produce', rows: [row('carrots'), row('onions')] },
    { sectionId: 'section.dairy', rows: [row('milk', { sectionId: 'section.dairy' })] },
  ],
  cart: [],
  total: 3,
};

describe('itemIdFromUrl', () => {
  it('reads the item ID from any app scheme, and nothing from other links', () => {
    expect(itemIdFromUrl('parentmanager-dev://list?item=0a1b-2c')).toBe('0a1b-2c');
    expect(itemIdFromUrl('https://example.com/recipe')).toBeNull();
    expect(itemIdFromUrl(null)).toBeNull();
  });
});

describe('planReminders (FR-EXP-3)', () => {
  it('creates one reminder per item in aisle order, with the line as title and the section as notes', () => {
    const plan = planReminders(doc(first), [], urlFor);
    expect(plan.create).toEqual([
      { itemId: 'carrots', title: 'carrots', notes: 'Produce', url: urlFor('carrots') },
      { itemId: 'onions', title: 'onions', notes: 'Produce', url: urlFor('onions') },
      { itemId: 'milk', title: 'milk', notes: 'Dairy and eggs', url: urlFor('milk') },
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.complete).toEqual([]);
  });

  it('re-export: 2 added and 1 checked gives 2 new reminders, 1 completed, no duplicates', () => {
    const earlier = [
      reminder('r1', 'carrots'),
      reminder('r2', 'onions'),
      reminder('r3', 'milk', { notes: 'Dairy and eggs' }),
    ];
    const now: ListView = {
      sections: [
        { sectionId: 'section.produce', rows: [row('apples'), row('carrots')] },
        {
          sectionId: 'section.dairy',
          rows: [
            row('butter', { sectionId: 'section.dairy' }),
            row('milk', { sectionId: 'section.dairy' }),
          ],
        },
      ],
      cart: [row('onions', { checked: true })],
      total: 5,
    };
    const plan = planReminders(doc(now), earlier, urlFor);
    expect(plan.create.map((r) => r.itemId)).toEqual(['apples', 'butter']);
    expect(plan.complete).toEqual(['r2']);
    expect(plan.update).toEqual([]);
  });

  it('completes reminders for removed items, and for checked items when they are included', () => {
    const view: ListView = {
      sections: [{ sectionId: 'section.produce', rows: [row('carrots')] }],
      cart: [row('onions', { checked: true })],
      total: 2,
    };
    const earlier = [reminder('r1', 'carrots'), reminder('r2', 'onions'), reminder('r3', 'milk')];
    expect(planReminders(doc(view, true), earlier, urlFor).complete).toEqual(['r2', 'r3']);
  });

  it('updates a reminder whose quantity changed', () => {
    const view: ListView = {
      sections: [
        {
          sectionId: 'section.produce',
          rows: [row('carrots', { quantity: [{ value: 4, unitId: 'unit.each' }] })],
        },
      ],
      cart: [],
      total: 1,
    };
    const plan = planReminders(doc(view), [reminder('r1', 'carrots')], urlFor);
    expect(plan.update).toEqual([{ id: 'r1', title: '4 carrots', notes: 'Produce' }]);
    expect(plan.create).toEqual([]);
  });

  it('leaves what the shopper completed and what they added by hand alone', () => {
    const plan = planReminders(
      doc(first),
      [
        reminder('r1', 'carrots', { completed: true, title: 'old' }),
        reminder('r9', null, { title: 'Birthday candles' }),
      ],
      urlFor,
    );
    expect(plan.create.map((r) => r.itemId)).toEqual(['onions', 'milk']);
    expect(plan.update).toEqual([]);
    expect(plan.complete).toEqual([]);
  });

  it('closes a duplicate left by an interrupted export', () => {
    const plan = planReminders(
      doc(first),
      [reminder('r1', 'carrots'), reminder('r2', 'carrots')],
      urlFor,
    );
    expect(plan.complete).toEqual(['r2']);
    expect(plan.create.map((r) => r.itemId)).toEqual(['onions', 'milk']);
  });
});
