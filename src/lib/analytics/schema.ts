/**
 * The analytics schema (F-07.2, NFR-SEC-6, spec section 3.0). Every event the app can send is
 * listed here with the exact properties it may carry, and every property has a kind that
 * only admits IDs, counts, durations and fixed values. Anything else — a name, an email, a
 * recipe title, list text — fails validation and is never sent.
 */

type IdSpec = { kind: 'id' };
type CodeSpec = { kind: 'code' };
type CountSpec = { kind: 'count'; max: number };
type DurationSpec = { kind: 'duration' };
type BoolSpec = { kind: 'bool' };
type OneOfSpec<V extends string> = { kind: 'oneOf'; values: readonly V[] };

export type PropertySpec =
  IdSpec | CodeSpec | CountSpec | DurationSpec | BoolSpec | OneOfSpec<string>;

/** A UUID, such as a recipe ID. */
const id: IdSpec = { kind: 'id' };
/**
 * A fixed identifier the app defines, such as an error code or `section.dairy`: lowercase
 * letters, digits, `_` and `.`, at most 64 characters. Pass constants only, never user input.
 */
const code: CodeSpec = { kind: 'code' };
/** A whole number from 0 up to `max`. */
const count = (max = 1_000_000): CountSpec => ({ kind: 'count', max });
/** Seconds or milliseconds, as the property's name says. */
const duration: DurationSpec = { kind: 'duration' };
const bool: BoolSpec = { kind: 'bool' };
const oneOf = <const V extends string>(...values: V[]): OneOfSpec<V> => ({ kind: 'oneOf', values });

const method = oneOf('email', 'apple', 'google');
export const ROLES = ['parent', 'family', 'caregiver'] as const;
const role = oneOf(...ROLES);
export const REGIONS = ['US', 'GB', 'AU'] as const;
export const TIERS = ['free', 'premium'] as const;
const inviteVia = oneOf('link', 'code');
const importInput = oneOf('url', 'text', 'photo', 'screenshot');
const exportTarget = oneOf('print', 'pdf', 'apple_reminders', 'share_text', 'copy_text');
const weekMode = oneOf('add', 'replace');
const exportScope = oneOf('household', 'account');

/** Spec section 3, the "Analytics events" table of each area. */
export const ANALYTICS_EVENTS = {
  // 3.1 Accounts and auth
  sign_in_started: { method },
  signed_up: { method },
  signed_in: { method, is_new_device: bool },
  sign_in_failed: { method, error_code: code },
  signed_out: {},
  biometric_lock_changed: { enabled: bool, timeout_minutes: count(1440) },
  // 3.2 Onboarding
  onboarding_started: { entry: oneOf('create', 'join') },
  onboarding_step_completed: { step: code, skipped: bool },
  household_created: {
    region: oneOf(...REGIONS),
    adults_count: count(20),
    children_count: count(20),
    has_expecting: bool,
    allergy_profiles_count: count(50),
  },
  onboarding_completed: { duration_seconds: duration },
  // 3.3 Households and members
  invite_created: { role, share_method: oneOf('share_sheet', 'copy', 'email') },
  invite_opened: { via: inviteVia },
  invite_accepted: { role, via: inviteVia, hours_since_created: duration },
  invite_failed: {
    reason: oneOf('expired', 'revoked', 'used', 'seat_limit', 'in_other_household'),
  },
  invite_revoked: { role },
  member_removed: { role },
  member_role_changed: { from_role: role, to_role: role },
  person_added: { kind: oneOf('adult', 'child'), age_band: code },
  dietary_profile_updated: { allergy_count: count(50), diet_count: count(50) },
  // 3.4 Recipes
  recipe_created: {
    source_type: code,
    ingredient_count: count(500),
    step_count: count(500),
    tag_count: count(100),
  },
  recipe_edited: { source_type: code },
  recipe_deleted: { plan_entries_affected: count() },
  starter_recipe_copied: { recipe_id: id },
  recipe_scaled: { from_servings: count(100), to_servings: count(100) },
  recipe_search_used: { results_count: count(), has_tag_filter: bool },
  allergen_notice_shown: {
    surface: oneOf('recipe', 'import_review', 'planner'),
    allergen_count: count(50),
  },
  // 3.5 AI import
  ai_import_started: { input_type: importInput, allowance_remaining: count() },
  ai_import_completed: {
    input_type: importInput,
    parser: oneOf('schema_org', 'llm'),
    duration_ms: duration,
    ingredient_count: count(500),
    low_confidence_count: count(500),
    unmatched_count: count(500),
    allergen_flag_count: count(500),
  },
  ai_import_failed: { input_type: importInput, error_code: code },
  ai_import_saved: {
    input_type: importInput,
    lines_edited_count: count(),
    seconds_in_review: duration,
  },
  ai_import_discarded: { input_type: importInput, seconds_in_review: duration },
  ai_allowance_reached: { tier: oneOf(...TIERS) },
  // 3.6 Planner
  plan_entry_added: {
    slot: code,
    source: oneOf('household_recipe', 'starter_recipe', 'free_text'),
    via: oneOf('recent', 'search', 'template'),
  },
  plan_entry_moved: { slot_changed: bool, day_changed: bool },
  plan_entry_removed: {},
  portions_set: { people_count: count(50), has_baby_plate: bool },
  leftover_linked: {},
  week_copied: { entries_count: count(), mode: weekMode },
  template_saved: { entries_count: count() },
  template_applied: { entries_count: count(), mode: weekMode },
  week_planned: { dinners_count: count(7), days_until_week_start: count(366) },
  // 3.7 Staples and pantry
  staple_added: { is_catalog_ingredient: bool },
  staple_removed: {},
  have_marked: { surface: oneOf('list', 'pantry') },
  have_undone: {},
  staple_added_to_list: {},
  // 3.8 Grocery list
  list_generated: {
    item_count: count(),
    merged_count: count(),
    staples_excluded_count: count(),
    have_excluded_count: count(),
    trigger: oneOf('auto', 'regenerate', 'plan_change'),
  },
  list_item_added: {
    source: oneOf('typed', 'suggestion_catalog', 'suggestion_frequent', 'assumed_at_home'),
    merged_into_existing: bool,
  },
  list_item_checked: { offline: bool, section_id: code },
  list_item_unchecked: { within_undo_window: bool },
  list_item_edited: { field: oneOf('quantity', 'unit', 'name') },
  list_item_deleted: { origin: oneOf('plan', 'manual') },
  shopping_finished: {
    checked_count: count(),
    unchecked_count: count(),
    members_who_checked_count: count(20),
  },
  // 3.9 List export
  list_exported: { target: exportTarget, item_count: count(), included_checked: bool },
  reminders_permission_result: { granted: bool },
  list_export_failed: { target: exportTarget, error_code: code },
  // 3.10 Purchase memory
  frequent_suggestion_used: { rank: count(100) },
  frequent_suggestion_hidden: {},
  // 3.11 Notifications (notification_sent is sent by the server)
  push_permission_prompted: { trigger: code },
  push_permission_result: { granted: bool },
  notification_opened: { type: code },
  notification_type_toggled: { type: code, enabled: bool, surface: code },
  quiet_hours_changed: { start_hour: count(23), end_hour: count(23) },
  // 3.12 Privacy and settings
  settings_changed: { setting: code, role },
  data_export_requested: { scope: exportScope },
  data_export_completed: { scope: exportScope, size_bucket: code },
  account_deletion_requested: { was_only_member: bool },
  account_deleted: { was_only_member: bool },
  analytics_opt_out_changed: { opted_out: bool },
} as const satisfies Record<string, Record<string, PropertySpec>>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;

type ValueOf<S> =
  S extends OneOfSpec<infer V>
    ? V
    : S extends BoolSpec
      ? boolean
      : S extends CountSpec | DurationSpec
        ? number
        : string;

/** The properties an event takes, typed from the schema. */
export type AnalyticsProperties<E extends AnalyticsEvent> = {
  -readonly [K in keyof (typeof ANALYTICS_EVENTS)[E]]: ValueOf<(typeof ANALYTICS_EVENTS)[E][K]>;
};

/** Thrown for an event or property outside the schema. Names keys, never values. */
export class AnalyticsSchemaError extends Error {
  override name = 'AnalyticsSchemaError';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/** Whether a value fits a property's kind. */
export function fitsSpec(spec: PropertySpec, value: unknown): boolean {
  switch (spec.kind) {
    case 'id':
      return typeof value === 'string' && UUID.test(value);
    case 'code':
      return typeof value === 'string' && value.length <= 64 && CODE.test(value);
    case 'count':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= spec.max;
    case 'duration':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    case 'bool':
      return typeof value === 'boolean';
    case 'oneOf':
      return typeof value === 'string' && spec.values.includes(value);
  }
}

/**
 * Checks an event against the schema at runtime, because types vanish at the boundary:
 * unknown events, unknown or missing properties and values of the wrong kind all throw.
 */
export function validateEvent(event: string, properties: Record<string, unknown> = {}) {
  if (!Object.hasOwn(ANALYTICS_EVENTS, event)) {
    throw new AnalyticsSchemaError(`Unknown analytics event "${event}"`);
  }
  const specs: Record<string, PropertySpec> = ANALYTICS_EVENTS[event as AnalyticsEvent];
  for (const key of Object.keys(properties)) {
    if (!Object.hasOwn(specs, key)) {
      throw new AnalyticsSchemaError(`"${event}" has no property "${key}"`);
    }
  }
  for (const [key, spec] of Object.entries(specs)) {
    if (!fitsSpec(spec, properties[key])) {
      throw new AnalyticsSchemaError(`"${event}" property "${key}" must be a ${spec.kind}`);
    }
  }
  return { ...properties };
}
