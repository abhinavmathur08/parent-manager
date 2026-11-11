import { REGION_SETTINGS } from '@/features/household/region';
import type { Region, UnitSystem } from '@/i18n';
import { getSupabase } from '@/lib/supabase';

/** What parents can change (FR-HH-15). The locale follows the region. */
export type HouseholdSettings = {
  name: string;
  region: Region;
  unitSystem: UnitSystem;
  timezone: string;
  /** ISO weekday: 1 is Monday, 7 is Sunday. */
  weekStart: 1 | 7;
};

export async function fetchHouseholdSettings(householdId: string): Promise<HouseholdSettings> {
  const { data, error } = await getSupabase()
    .from('households')
    .select('name, region, unit_system, timezone, week_start')
    .eq('id', householdId)
    .single<{
      name: string;
      region: Region;
      unit_system: UnitSystem;
      timezone: string;
      week_start: number;
    }>();
  if (error) throw error;
  return {
    name: data.name,
    region: data.region,
    unitSystem: data.unit_system,
    timezone: data.timezone,
    weekStart: data.week_start === 1 ? 1 : 7,
  };
}

/** Choosing a region resets units and week start to its defaults, which can then be changed. */
export function withRegion(settings: HouseholdSettings, region: Region): HouseholdSettings {
  const defaults = REGION_SETTINGS[region];
  return { ...settings, region, unitSystem: defaults.unitSystem, weekStart: defaults.weekStart };
}

/**
 * Saves the settings. RLS lets only parents update the household. Stored quantities are in
 * base units, so a new region or unit system changes only how they're shown.
 */
export async function saveHouseholdSettings(
  householdId: string,
  settings: HouseholdSettings,
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('households')
    .update({
      name: settings.name.trim(),
      region: settings.region,
      locale: REGION_SETTINGS[settings.region].locale,
      unit_system: settings.unitSystem,
      timezone: settings.timezone,
      week_start: settings.weekStart,
    })
    .eq('id', householdId)
    .select('id');
  if (error) throw error;
  // RLS turns a non-parent's update into zero rows rather than an error.
  if (!data || data.length === 0) throw new Error('household.not_updated');
}
