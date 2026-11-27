import type { ChildAgeBand } from '@/features/people/codes';
import type { Region } from '@/i18n';

import data from './starter-templates.json';

/**
 * Starter checklists (K-01, FR3-CHK-5, R3-CHK-1): templates shipped with the app as data, so
 * they work offline (NFR3-OFF-1). Each template and item is a language-neutral ID; its text is
 * in the locale files under that ID, for example `t('checklist_item.newborn.register_birth')`.
 *
 * Unlike the rest of the locale files, every checklist text is written out in each locale its
 * regions use, with no fallback to en-US, because each market's text is reviewed on its own
 * (D-27, NFR3-L10N-1). `pnpm run checklists:check` (scripts/checklist-content.js) enforces
 * that, the regions, the due offsets and the no-medical-advice wording rules (FR3-CHK-8).
 *
 * PLACEHOLDER CONTENT until K-04 (#354) lands the reviewed drafts. Bump `version` in the JSON
 * whenever the content changes. Template and item IDs are health-related data (AS3-3), so they
 * never go to analytics, Sentry or logs (NFR3-SEC-2).
 */

/** What a reviewer must check before an item ships (D-27). */
export type ReviewFlag = 'health' | 'legal';

export type StarterItemId = `checklist_item.${string}`;
export type StarterTemplateId = `checklist.${string}`;

export type StarterItem = {
  id: StarterItemId;
  /** Where the item applies. Omitted means every region of its template. */
  regions?: readonly Region[];
  /**
   * Days from the anchor (FR3-CHK-4): the first day of the due month when expecting, so
   * negative, or the day the checklist starts for a baby. Null means Anytime.
   */
  dueOffsetDays: number | null;
  review?: readonly ReviewFlag[];
};

export type StarterTemplate = {
  id: StarterTemplateId;
  stage: ChildAgeBand;
  regions: readonly Region[];
  items: readonly StarterItem[];
};

export const STARTER_TEMPLATES_VERSION: number = data.version;

// The JSON's shape is checked by scripts/checklist-content.js in CI.
export const STARTER_TEMPLATES = data.templates as unknown as readonly StarterTemplate[];

function forRegion(template: StarterTemplate, region: Region): StarterTemplate {
  return {
    ...template,
    items: template.items.filter((item) => (item.regions ?? template.regions).includes(region)),
  };
}

/** Every template a household in this region can browse (S-47), with only its region's items. */
export function templatesForRegion(region: Region): StarterTemplate[] {
  return STARTER_TEMPLATES.filter((t) => t.regions.includes(region)).map((t) =>
    forRegion(t, region),
  );
}

/** The templates suggested first for the household's stage (FR3-CHK-1). */
export function suggestedTemplates(stage: ChildAgeBand, region: Region): StarterTemplate[] {
  return templatesForRegion(region).filter((t) => t.stage === stage);
}

/** One template with its region's items, or undefined if it isn't offered in that region. */
export function starterTemplate(id: string, region: Region): StarterTemplate | undefined {
  return templatesForRegion(region).find((t) => t.id === id);
}

const ITEM_IDS = new Set<string>(STARTER_TEMPLATES.flatMap((t) => t.items.map((i) => i.id)));

/** Whether a stored `template_item_id` is one this app version ships (R3-TASK-2). */
export function isStarterItemId(id: string): id is StarterItemId {
  return ITEM_IDS.has(id);
}
