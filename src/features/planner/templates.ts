import { useCallback } from 'react';

import { track } from '@/lib/analytics';
import { getSupabase } from '@/lib/supabase';
import { useSyncWriter } from '@/lib/sync';

import { nextPosition, type PlanPerson, weekEntries } from './plan';
import { SLOTS, type PlanEntryPortionRow, type PlanEntryRow, type Slot } from './tables';
import { copyEntry } from './writes';
import { addDays, daysBetween, type PlanDate } from './week';

/**
 * Saved week templates (P-05, FR-PLAN-10). Premium only, enforced by the server's policies on
 * `week_templates`: a free household can neither save nor read one, so it can't apply one
 * either. Templates are read and written online; applying one writes ordinary plan entries
 * through sync, like "copy last week".
 */
export const TEMPLATE_NAME_MAX = 60;

export type TemplatePortion = { person_id: string; portions: number; variant: string };

export type TemplateEntry = {
  /** The entry this was saved from, so leftover links inside the week survive. */
  id: string;
  /** Days from the week start, 0 to 6. */
  day: number;
  slot: Slot;
  position: number;
  recipe_id: string | null;
  free_text: string | null;
  /** The recipe's title when saved, used as free text if the recipe is gone later. */
  title: string | null;
  servings: number;
  leftover_of: string | null;
  portions: TemplatePortion[];
};

export type WeekTemplate = { id: string; name: string; entries: TemplateEntry[] };

export type TemplateRefusal = 'premium_required' | 'limit';

/** The week starting on `start`, as template entries. */
export function templateFromWeek(
  rows: readonly PlanEntryRow[],
  portions: readonly PlanEntryPortionRow[],
  start: PlanDate,
  titles: ReadonlyMap<string, string>,
): TemplateEntry[] {
  const week = weekEntries(rows, start);
  const inWeek = new Set(week.map((e) => e.id));
  return week.map((entry) => ({
    id: entry.id,
    day: daysBetween(start, entry.date),
    slot: entry.slot,
    position: entry.position,
    recipe_id: entry.recipe_id,
    free_text: entry.free_text,
    title: entry.recipe_id ? (titles.get(entry.recipe_id) ?? null) : null,
    servings: entry.servings,
    leftover_of:
      entry.leftover_of_entry_id && inWeek.has(entry.leftover_of_entry_id)
        ? entry.leftover_of_entry_id
        : null,
    portions: portions
      .filter((p) => p.entry_id === entry.id && !p.deleted_at)
      .map((p) => ({ person_id: p.person_id, portions: p.portions, variant: p.variant })),
  }));
}

/** Sync bookkeeping for rows that exist only while a template is applied. */
const ROW = { household_id: '', version: 0, created_at: null, updated_at: null, deleted_at: null };

export type TemplateCopy = {
  source: PlanEntryRow;
  portions: PlanEntryPortionRow[];
  date: PlanDate;
  slot: Slot;
  position: number;
  leftoverOfSource: string | null;
};

/**
 * What applying a template to the week starting on `start` writes (FR-PLAN-10, like copy):
 * the same weekdays and slots, after any entries kept in the week. A recipe deleted since is
 * planned as its saved title, and portions only for people the household still has.
 */
export function templateCopies(
  template: WeekTemplate,
  start: PlanDate,
  existing: readonly PlanEntryRow[],
  recipeIds: ReadonlySet<string>,
  people: readonly PlanPerson[],
): TemplateCopy[] {
  const known = new Set(people.map((p) => p.id));
  const saved = new Set(template.entries.map((e) => e.id));
  const taken = [...existing];
  const ordered = [...template.entries].sort(
    (a, b) =>
      a.day - b.day || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || a.position - b.position,
  );
  const copies: TemplateCopy[] = [];
  for (const entry of ordered) {
    const date = addDays(start, Math.min(Math.max(entry.day, 0), 6));
    const recipe = entry.recipe_id && recipeIds.has(entry.recipe_id) ? entry.recipe_id : null;
    const freeText = recipe ? null : (entry.free_text ?? entry.title);
    if (!recipe && !freeText) continue;
    const position = nextPosition(taken, date, entry.slot);
    const source: PlanEntryRow = {
      ...ROW,
      id: entry.id,
      date,
      slot: entry.slot,
      position,
      recipe_id: recipe,
      free_text: freeText,
      servings: entry.servings,
      leftover_of_entry_id: null,
    };
    taken.push({ ...source, id: `template:${entry.id}` });
    copies.push({
      source,
      date,
      slot: entry.slot,
      position,
      leftoverOfSource:
        entry.leftover_of && saved.has(entry.leftover_of) ? entry.leftover_of : null,
      portions: entry.portions
        .filter((p) => known.has(p.person_id))
        .map((p) => ({
          ...ROW,
          id: `${entry.id}:${p.person_id}`,
          entry_id: entry.id,
          person_id: p.person_id,
          portions: p.portions,
          variant: p.variant as PlanEntryPortionRow['variant'],
        })),
    });
  }
  return copies;
}

function refusal(error: { code?: string; hint?: string | null } | null): TemplateRefusal | null {
  if (!error) return null;
  if (error.code === '42501') return 'premium_required';
  if (error.hint === 'template.limit') return 'limit';
  return null;
}

/** Thrown when the server refuses a template action. */
export class TemplateRefused extends Error {
  constructor(readonly reason: TemplateRefusal) {
    super(reason);
  }
}

export async function fetchTemplates(householdId: string): Promise<WeekTemplate[]> {
  const { data, error } = await getSupabase()
    .from('week_templates')
    .select('id, name, entries')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as WeekTemplate[];
}

export async function saveTemplate(householdId: string, name: string, entries: TemplateEntry[]) {
  const { error } = await getSupabase()
    .from('week_templates')
    .insert({ household_id: householdId, name: name.trim(), entries });
  const reason = refusal(error);
  if (reason) throw new TemplateRefused(reason);
  if (error) throw error;
  track('template_saved', { entries_count: entries.length });
}

export async function deleteTemplate(id: string) {
  const { error } = await getSupabase().from('week_templates').delete().eq('id', id);
  if (error) throw error;
}

/** Writes a template's entries into a week through sync. Returns the new entry IDs. */
export function useApplyTemplate() {
  const writer = useSyncWriter();
  return useCallback(
    async (copies: readonly TemplateCopy[], mode: 'add' | 'replace'): Promise<string[]> => {
      const ids = new Map<string, string>();
      for (const copy of copies) {
        const id = await copyEntry(writer, copy.source, copy.portions, {
          date: copy.date,
          slot: copy.slot,
          position: copy.position,
          leftoverOf: copy.leftoverOfSource ? (ids.get(copy.leftoverOfSource) ?? null) : null,
        });
        ids.set(copy.source.id, id);
      }
      track('template_applied', { entries_count: copies.length, mode });
      return [...ids.values()];
    },
    [writer],
  );
}
