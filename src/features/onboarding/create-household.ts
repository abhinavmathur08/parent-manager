import { REGION_SETTINGS } from '@/features/household/region';
import type { OnboardingPersonPayload } from '@/features/onboarding/people';
import type { Region } from '@/i18n';
import { getSupabase } from '@/lib/supabase';

export const MAX_HOUSEHOLD_NAME = 100;

/**
 * Creates the household with the caller as its first parent, together with the people it
 * feeds and their allergies and diets, in one transaction (`complete_onboarding`). The
 * region sets the locale, units and week start; the time zone comes from the device
 * (FR-ONB-2, FR-ONB-3). The pantry's default staples are added by the database (FR-ONB-6).
 */
export async function completeOnboarding(input: {
  name: string;
  region: Region;
  timezone: string;
  people: OnboardingPersonPayload[];
}): Promise<string> {
  const settings = REGION_SETTINGS[input.region];
  const { data, error } = await getSupabase().rpc('complete_onboarding', {
    name: input.name.trim(),
    region: input.region,
    locale: settings.locale,
    unit_system: settings.unitSystem,
    timezone: input.timezone,
    week_start: settings.weekStart,
    people: input.people,
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
