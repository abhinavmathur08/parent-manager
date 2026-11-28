import { CHILD_AGE_BANDS } from '@/features/people/codes';
import {
  isStarterItemId,
  STARTER_TEMPLATES,
  starterTemplate,
  suggestedTemplates,
  templatesForRegion,
} from '@/features/checklists/templates';
import { i18n } from '@/i18n';

import enAU from '@/i18n/locales/en-AU.json';
import enGB from '@/i18n/locales/en-GB.json';
import enUS from '@/i18n/locales/en-US.json';
import data from '@/features/checklists/starter-templates.json';

const { validate, STAGES } = require('../../scripts/checklist-content.js');

const ALL_ITEMS = STARTER_TEMPLATES.flatMap((t) => t.items);
const NOT_GB = ALL_ITEMS.filter((i) => i.regions !== undefined && !i.regions.includes('GB'));
const US_ONLY = ALL_ITEMS.filter((i) => i.regions?.length === 1 && i.regions[0] === 'US');

describe('starter templates by region (FR3-CHK-5, R3-CHK-1)', () => {
  it('never gives a GB household an item that is not offered in GB', () => {
    expect(US_ONLY.length).toBeGreaterThan(0);
    const gbItems = templatesForRegion('GB').flatMap((t) => t.items);
    for (const item of NOT_GB) expect(gbItems).not.toContainEqual(item);
    for (const item of gbItems) expect(item.regions ?? ['GB']).toContain('GB');
  });

  it('keeps US-only items for a US household', () => {
    const usItems = templatesForRegion('US').flatMap((t) => t.items);
    for (const item of US_ONLY) expect(usItems).toContainEqual(item);
  });

  it('suggests the templates for the household stage (FR3-CHK-1)', () => {
    expect(suggestedTemplates('expecting', 'AU').map((t) => t.id)).toEqual([
      'checklist.expecting.prepare_home',
      'checklist.expecting.hospital_bag',
      'checklist.expecting.paperwork',
    ]);
    expect(suggestedTemplates('infant_0_6m', 'GB').map((t) => t.id)).toEqual([
      'checklist.newborn.first_weeks',
      'checklist.newborn.home_routines',
    ]);
    expect(suggestedTemplates('infant_6_12m', 'US')).toEqual([]);
  });

  it('finds one template by ID, filtered to the region', () => {
    expect(starterTemplate('checklist.newborn.first_weeks', 'GB')?.items.length).toBeGreaterThan(0);
    expect(starterTemplate('checklist.unknown.list', 'US')).toBeUndefined();
  });

  it('recognises shipped item IDs only', () => {
    const [first] = STARTER_TEMPLATES[0].items;
    expect(isStarterItemId(first.id)).toBe(true);
    expect(isStarterItemId('checklist_item.newborn.not_shipped')).toBe(false);
  });

  it('shows item text in the household locale with regional words', () => {
    const item = 'checklist_item.expecting.set_up_changing_station';
    expect(i18n.getFixedT('en-US')(item)).toMatch(/diaper/);
    expect(i18n.getFixedT('en-GB')(item)).toMatch(/nappy/);
    expect(i18n.getFixedT('en-AU')(item)).toMatch(/nappy/);
  });
});

describe('the shipped content', () => {
  it('passes the content check', () => {
    expect(validate(data, { 'en-US': enUS, 'en-GB': enGB, 'en-AU': enAU })).toEqual([]);
  });

  it('uses the same stages as the age bands (D-6)', () => {
    expect(STAGES).toEqual([...CHILD_AGE_BANDS]);
  });
});
