/**
 * Planner analytics events (spec 3.6). Events carry only IDs, counts and fixed values.
 *
 * TODO(F-07.2, #22 / PR #164): the analytics wrapper (`track` from `@/lib/analytics`) isn't
 * on this branch's base yet. Once it merges, replace the body of `trackPlanEvent` with
 * `track(name, properties)`; the names and properties below already match spec 3.6 and
 * `src/lib/analytics/schema.ts`. Until then this records nothing.
 */
export type PlanEvent =
  | {
      name: 'plan_entry_added';
      properties: {
        slot: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink';
        source: 'household_recipe' | 'starter_recipe' | 'free_text';
        via: 'recent' | 'search' | 'template';
      };
    }
  | { name: 'plan_entry_moved'; properties: { slot_changed: boolean; day_changed: boolean } }
  | { name: 'plan_entry_removed'; properties: Record<string, never> }
  | { name: 'portions_set'; properties: { people_count: number; has_baby_plate: boolean } }
  | { name: 'week_copied'; properties: { entries_count: number; mode: 'add' | 'replace' } }
  | {
      name: 'week_planned';
      properties: { dinners_count: number; days_until_week_start: number };
    };

export function trackPlanEvent<N extends PlanEvent['name']>(
  name: N,
  properties: Extract<PlanEvent, { name: N }>['properties'],
): void {
  void name;
  void properties;
}
