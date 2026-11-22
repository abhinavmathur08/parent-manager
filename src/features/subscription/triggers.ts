import type { PAYWALL_TRIGGERS } from '@/lib/analytics/schema';

/**
 * Where the Premium sheet opens from (FR-PAY-5). Each trigger leads with its own benefit
 * (FR-PAY-4); `premium_section` is the Household tab's Premium row, the only place Premium
 * shows without a moment of need.
 */
export type PremiumTrigger = (typeof PAYWALL_TRIGGERS)[number];

/** The AI import allowance per month (FR-AI-9, decided D-9). The server enforces it. */
export const AI_IMPORTS_PER_MONTH = { free: 5, premium: 100 } as const;

export type PremiumBenefit = 'seats' | 'ai' | 'templates' | 'history' | 'reminders' | 'busy_meals';

/** Premium's benefits, in the order the sheet lists them (FR-PAY-3, FR2-PAY-1). */
export const PREMIUM_BENEFITS: readonly PremiumBenefit[] = [
  'seats',
  'ai',
  'templates',
  'history',
  'reminders',
  'busy_meals',
];

const LEAD: Record<PremiumTrigger, PremiumBenefit | null> = {
  caregiver_invite: 'seats',
  family_invite: 'seats',
  ai_allowance: 'ai',
  template: 'templates',
  history: 'history',
  premium_section: null,
  reminders: 'reminders',
  busy_day_meals: 'busy_meals',
};

/** The benefit the trigger names first, then the others (FR-PAY-4). */
export function benefitsFor(trigger: PremiumTrigger): {
  lead: PremiumBenefit | null;
  others: PremiumBenefit[];
} {
  const lead = LEAD[trigger];
  return { lead, others: PREMIUM_BENEFITS.filter((benefit) => benefit !== lead) };
}
