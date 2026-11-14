import {
  deleteAccount,
  fetchDeletionPreview,
  isLastParentRefusal,
  needsReauthentication,
} from '@/features/account/deletion';
import {
  assertSameAccount,
  DifferentAccountError,
  requestReauthCode,
} from '@/features/account/reauth';
import { storeSubscriptionsUrl } from '@/features/account/store-subscriptions';

const mockRpc = jest.fn();
const mockOtp = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    auth: { signInWithOtp: mockOtp, getSession: mockGetSession },
  }),
}));
jest.mock('@/features/auth/apple', () => ({ signInWithAppleNative: jest.fn() }));
jest.mock('@/features/auth/google', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('@/features/auth/social', () => ({ signInWithBrowser: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

describe('account deletion data (FR-PRIV-3)', () => {
  it('reads the preview', async () => {
    mockRpc.mockResolvedValue({
      data: { outcome: 'leave', household_id: 'h1', household_name: 'Home' },
      error: null,
    });
    await expect(fetchDeletionPreview()).resolves.toEqual({
      outcome: 'leave',
      householdId: 'h1',
      householdName: 'Home',
    });
    expect(mockRpc).toHaveBeenCalledWith('account_deletion_preview');
  });

  it('refuses an outcome it does not know', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'surprise' }, error: null });
    await expect(fetchDeletionPreview()).rejects.toThrow('Unknown deletion outcome');
  });

  it('deletes and says whether the household went too', async () => {
    mockRpc.mockResolvedValue({ data: { household_deleted: true }, error: null });
    await expect(deleteAccount()).resolves.toEqual({ householdDeleted: true });
    expect(mockRpc).toHaveBeenCalledWith('delete_account');
  });

  it('passes on a server refusal', async () => {
    const refusal = { code: '42501', hint: 'account.reauthentication_required' };
    mockRpc.mockResolvedValue({ data: null, error: refusal });
    await expect(deleteAccount()).rejects.toBe(refusal);
    expect(needsReauthentication(refusal)).toBe(true);
    expect(isLastParentRefusal({ hint: 'member.last_parent' })).toBe(true);
    expect(isLastParentRefusal(new Error('x'))).toBe(false);
  });
});

describe('re-authentication', () => {
  it('emails a code to the account without ever creating one', async () => {
    mockOtp.mockResolvedValue({ error: null });
    await requestReauthCode(' Sam@Example.com ');
    expect(mockOtp).toHaveBeenCalledWith({
      email: 'sam@example.com',
      options: { shouldCreateUser: false },
    });
  });

  it('refuses when the new sign-in is a different account', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'other' } } } });
    await expect(assertSameAccount('u1')).rejects.toBeInstanceOf(DifferentAccountError);
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    await expect(assertSameAccount('u1')).resolves.toBeUndefined();
  });

  it('links to the right store for subscriptions', () => {
    expect(storeSubscriptionsUrl('ios')).toBe('https://apps.apple.com/account/subscriptions');
    expect(storeSubscriptionsUrl('android')).toBe(
      'https://play.google.com/store/account/subscriptions',
    );
  });
});
