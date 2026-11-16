import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabase } from '@/lib/supabase';

import type { MockStoreBackend, MockStoreSubscription } from './mock-provider';
import { BillingError, type BillingErrorCode } from './types';

/** The Edge Function that plays the store (M-01.2). Off unless the project enables it. */
export const MOCK_STORE_FUNCTION = 'mock-store';

/** Server error codes, mapped to RevenueCat's error codes. */
const ERROR_CODES: Record<string, BillingErrorCode> = {
  'billing.mock_disabled': 'CONFIGURATION_ERROR',
  'billing.unauthenticated': 'CONFIGURATION_ERROR',
  'billing.not_a_parent': 'PURCHASE_NOT_ALLOWED_ERROR',
  'billing.already_premium': 'PRODUCT_ALREADY_PURCHASED_ERROR',
  'billing.already_subscribed': 'PRODUCT_ALREADY_PURCHASED_ERROR',
  'billing.unknown_product': 'STORE_PROBLEM_ERROR',
  'billing.invalid_request': 'STORE_PROBLEM_ERROR',
};

/** Calls the mock store with the signed-in user's session. */
export async function callMockStore<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke<T>(MOCK_STORE_FUNCTION, { body });
  if (error) throw await toBillingError(error);
  return data as T;
}

export async function toBillingError(error: unknown): Promise<BillingError> {
  if (error instanceof FunctionsHttpError) {
    let code: string | undefined;
    try {
      const body = (await (error.context as Response).json()) as { error?: { code?: string } };
      code = body.error?.code;
    } catch {
      code = undefined;
    }
    return new BillingError((code && ERROR_CODES[code]) || 'STORE_PROBLEM_ERROR', code);
  }
  if (error instanceof FunctionsFetchError) return new BillingError('NETWORK_ERROR');
  return new BillingError('UNKNOWN_ERROR');
}

export const httpMockStoreBackend: MockStoreBackend = {
  async subscription() {
    const result = await callMockStore<{ subscription: MockStoreSubscription | null }>({
      action: 'subscription',
    });
    return result.subscription;
  },
  async purchase(input) {
    const result = await callMockStore<{ subscription: MockStoreSubscription }>({
      action: 'purchase',
      ...input,
    });
    return result.subscription;
  },
  async restore() {
    const result = await callMockStore<{ subscription: MockStoreSubscription | null }>({
      action: 'restore',
    });
    return result.subscription;
  },
};

/** The mock store's settings and test clock (M-02.2). Development and test builds only. */
export type MockOperation = 'cancel' | 'uncancel' | 'change_product' | 'refund' | 'fix_payment';
export type MockClockTarget = 'renewal' | 'trial_end' | 'billing_issue' | 'grace_end' | 'expiry';

export const mockStoreAdmin = {
  /** Whether the server has the mock store turned on (BILLING_MOCK_ENABLED). */
  async enabled(): Promise<boolean> {
    try {
      const result = await callMockStore<{ enabled: boolean }>({ action: 'status' });
      return result.enabled === true;
    } catch {
      return false;
    }
  },
  async manage(operation: MockOperation, productId?: string) {
    const result = await callMockStore<{ subscription: MockStoreSubscription | null }>({
      action: 'manage',
      operation,
      productId,
    });
    return result.subscription;
  },
  async advance(householdId: string, to: MockClockTarget) {
    const result = await callMockStore<{ subscription: MockStoreSubscription | null }>({
      action: 'advance',
      householdId,
      to,
    });
    return result.subscription;
  },
};
