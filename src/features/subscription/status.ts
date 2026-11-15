import type { Entitlement } from './entitlement';

/**
 * What S-33 says about the household's subscription (M-02.2, FR-PAY-8): the state and the one
 * date that matters for it.
 */
export type StatusSummary =
  | { kind: 'free' }
  | { kind: 'trial'; date: string | null }
  | { kind: 'renews'; date: string | null }
  | { kind: 'ends'; date: string | null }
  | { kind: 'grace'; date: string | null }
  | { kind: 'expired'; date: string | null }
  | { kind: 'refunded'; date: string | null };

export function statusSummary(entitlement: Entitlement | null): StatusSummary {
  if (!entitlement || entitlement.status === 'none') return { kind: 'free' };
  const end = entitlement.periodEndsAt;
  switch (entitlement.status) {
    case 'expired':
      return { kind: 'expired', date: end };
    case 'refunded':
      return { kind: 'refunded', date: end };
    case 'grace_period':
      return { kind: 'grace', date: entitlement.graceEndsAt ?? end };
  }
  if (entitlement.tier !== 'premium') return { kind: 'free' };
  if (!entitlement.willRenew) return { kind: 'ends', date: end };
  if (entitlement.status === 'trialing')
    return { kind: 'trial', date: entitlement.trialEndsAt ?? end };
  return { kind: 'renews', date: end };
}

export type PlanPeriod = 'monthly' | 'annual';

export function planPeriod(productId: string | null): PlanPeriod | null {
  if (productId === 'pm_premium_monthly') return 'monthly';
  if (productId === 'pm_premium_annual') return 'annual';
  return null;
}
