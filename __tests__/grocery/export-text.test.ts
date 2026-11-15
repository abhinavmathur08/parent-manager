import { buildExportDocument } from '@/features/grocery/export/document';
import { exportText } from '@/features/grocery/export/text';
import type { ListRowView, ListView } from '@/features/grocery/view';
import { i18n } from '@/i18n';

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
const view: ListView = {
  sections: [
    {
      sectionId: 'section.produce',
      rows: [row('carrots', { quantity: [{ value: 3, unitId: 'unit.each' }] })],
    },
    {
      sectionId: 'section.dairy',
      rows: [
        row('milk', { sectionId: 'section.dairy', quantity: [{ value: 2, unitId: 'unit.l' }] }),
      ],
    },
  ],
  cart: [row('apples', { checked: true })],
  total: 3,
};
const text = (locale: 'en-US' | 'en-GB', includeChecked = false) => {
  const t = i18n.getFixedT(locale);
  return exportText(
    buildExportDocument({ view, weekStart: '2026-11-15', includeChecked, locale, t }),
    t,
  );
};

describe('exportText (FR-EXP-4, FR-EXP-6)', () => {
  it('is plain checklist text grouped under section headings', () => {
    expect(text('en-US')).toBe(
      [
        'Groceries, Nov 15 – Nov 21',
        '',
        'Produce',
        '☐ 3 carrots',
        '',
        'Dairy and eggs',
        '☐ 2 L milk',
      ].join('\n'),
    );
  });

  it('is localized: section names, units and dates follow the locale', () => {
    expect(text('en-GB')).toBe(
      [
        'Groceries, 15 Nov – 21 Nov',
        '',
        'Fruit and veg',
        '☐ 3 carrots',
        '',
        'Dairy and eggs',
        '☐ 2 litres milk',
      ].join('\n'),
    );
  });

  it('ticks included checked items', () => {
    expect(text('en-US', true).split('\n').slice(2, 5)).toEqual([
      'Produce',
      '☑ apples',
      '☐ 3 carrots',
    ]);
  });

  it('has no markup that would show up when pasted', () => {
    expect(text('en-US', true)).not.toMatch(/[<>*#_[\]]/);
  });
});
