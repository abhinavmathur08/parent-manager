import { buildExportDocument } from '@/features/grocery/export/document';
import { escapeHtml, exportHtml } from '@/features/grocery/export/html';
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
  checkedBy: null,
  sectionId: 'section.produce',
  allergens: [],
  ...over,
});

// Three sections, as S-13 shows them: produce, dairy, pantry; two items already in the cart.
const view: ListView = {
  sections: [
    {
      sectionId: 'section.produce',
      rows: [
        row('carrots', { quantity: [{ value: 3, unitId: 'unit.each' }] }),
        row('onions', { quantity: [{ value: 2, unitId: 'unit.each' }] }),
      ],
    },
    {
      sectionId: 'section.dairy',
      rows: [
        row('milk', { sectionId: 'section.dairy', quantity: [{ value: 2, unitId: 'unit.l' }] }),
      ],
    },
    { sectionId: 'section.pantry', rows: [row('lentils', { sectionId: 'section.pantry' })] },
  ],
  cart: [
    row('apples', { checked: true }),
    row('yogurt', { checked: true, sectionId: 'section.dairy' }),
  ],
  total: 6,
};

const build = (over: Partial<Parameters<typeof buildExportDocument>[0]> = {}) =>
  buildExportDocument({
    view,
    weekStart: '2026-11-15',
    includeChecked: false,
    locale: 'en-US',
    t,
    ...over,
  });

describe('buildExportDocument (FR-EXP-1, FR-EXP-6)', () => {
  it('keeps the screen’s sections, order and quantities, unchecked items only by default', () => {
    const doc = build();
    expect(doc.sections.map((s) => s.sectionId)).toEqual([
      'section.produce',
      'section.dairy',
      'section.pantry',
    ]);
    expect(doc.sections.map((s) => s.heading)).toEqual(['Produce', 'Dairy and eggs', 'Pantry']);
    expect(doc.sections.flatMap((s) => s.items.map((i) => i.line))).toEqual([
      '3 carrots',
      '2 onions',
      '2 L milk',
      'lentils',
    ]);
    expect(doc.itemCount).toBe(4);
    expect(doc.includedChecked).toBe(false);
  });

  it('puts checked items back under their own section, in name order, when included', () => {
    const doc = build({ includeChecked: true });
    expect(doc.sections.map((s) => s.items.map((i) => `${i.id}:${i.checked}`))).toEqual([
      ['apples:true', 'carrots:false', 'onions:false'],
      ['milk:false', 'yogurt:true'],
      ['lentils:false'],
    ]);
    expect(doc.itemCount).toBe(6);
  });

  it('names the list and the week in the locale', () => {
    expect(build()).toMatchObject({ title: 'Groceries', week: 'Nov 15 – Nov 21' });
    expect(build({ locale: 'en-GB', t: i18n.getFixedT('en-GB') }).week).toBe('15 Nov – 21 Nov');
  });

  it('formats quantities in the locale and takes section names from translations', () => {
    const doc = build({ locale: 'en-GB', t: i18n.getFixedT('en-GB') });
    expect(doc.sections[0]?.heading).toBe('Fruit and veg');
    expect(doc.sections[1]?.items[0]?.line).toBe('2 litres milk');
  });

  it('is empty when nothing is left to buy', () => {
    const doc = build({ view: { sections: [], cart: view.cart, total: 2 } });
    expect(doc.sections).toEqual([]);
    expect(doc.itemCount).toBe(0);
  });
});

describe('exportHtml (FR-EXP-2)', () => {
  it('prints one heading per section and one checkbox line per item', () => {
    const html = exportHtml(build(), t);
    expect(html.match(/<h2>/g)).toHaveLength(3);
    expect(html.match(/<li/g)).toHaveLength(4);
    expect(html).toContain('<h1>Groceries</h1>');
    expect(html).toContain('Nov 15 – Nov 21');
    expect(html).toContain('<span class="text">2 L milk</span>');
    expect(html).toContain('aria-label="Not checked"');
    expect(html).not.toMatch(/<img/);
  });

  it('marks included checked items and sets the text direction', () => {
    const html = exportHtml(build({ includeChecked: true }), t, 'rtl');
    expect(html).toContain('<html dir="rtl">');
    expect(html.match(/class="done"/g)).toHaveLength(2);
  });

  it('escapes member-typed names', () => {
    const doc = build({
      view: {
        sections: [{ sectionId: 'section.other', rows: [row('<b>&</b>')] }],
        cart: [],
        total: 1,
      },
    });
    expect(exportHtml(doc, t)).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(escapeHtml(`"it's"`)).toBe('&quot;it&#39;s&quot;');
  });
});
