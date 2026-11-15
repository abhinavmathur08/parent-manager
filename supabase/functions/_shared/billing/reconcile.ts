// Reconciliation (architecture section 8): a job that compares each household's entitlement
// with the provider and repairs drift, for example after a lost webhook.
//
// The mock store needs none: it applies its own events in the same request, and restore sends
// the latest one again. RevenueCat's implementation will read its REST API nightly and apply
// the difference through the same idempotent path (apply.ts).

export type ReconcileResult = { householdId: string; outcome: 'unchanged' | 'updated' };

export interface Reconciler {
  readonly source: 'mock' | 'revenuecat';
  /** Checks one household, or all of them when no ID is given. */
  reconcile(householdId?: string): Promise<ReconcileResult[]>;
}

/** The mock store's reconciler: nothing can drift, so it does nothing. */
export const mockReconciler: Reconciler = {
  source: 'mock',
  reconcile() {
    return Promise.resolve([]);
  },
};
