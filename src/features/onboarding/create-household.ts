import { REGION_SETTINGS } from '@/features/household/region';
import type { Region } from '@/i18n';
import { getSupabase } from '@/lib/supabase';

export const MAX_HOUSEHOLD_NAME = 100;

/**
 * Creates the household with the caller as its first parent (H-01.1's `create_household`).
 * The region sets the locale, units and week start; the time zone comes from the device
 * (FR-ONB-2, FR-ONB-3). The pantry's default staples are added by the database (FR-ONB-6).
 */
export async function createHousehold(input: {
  name: string;
  region: Region;
  timezone: string;
}): Promise<string> {
  const settings = REGION_SETTINGS[input.region];
  const { data, error } = await getSupabase().rpc('create_household', {
    name: input.name.trim(),
    region: input.region,
    locale: settings.locale,
    unit_system: settings.unitSystem,
    timezone: input.timezone,
    week_start: settings.weekStart,
  });
  if (error) throw error;
  return data as string;
}

/** Whether the error means the caller already has a household, so onboarding is done. */
export function isAlreadyMember(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { hint?: string }).hint === 'household.already_member'
  );
}
