import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CreateHouseholdScreen } from '@/features/onboarding/create-household-screen';
import { OnboardingDraftProvider, readOnboardingStep } from '@/features/onboarding/draft';
import { WelcomeScreen } from '@/features/onboarding/welcome-screen';
import { clearAllDrafts } from '@/hooks/use-draft-state';

const mockRpc = jest.fn();
const mockUpdate = jest.fn();
const mockRefresh = jest.fn();
let mockDisplayName: string | null = null;
let mockRegionCode = 'US';

jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc }) }));
jest.mock('@/features/onboarding/profile', () => ({
  fetchDisplayName: async () => mockDisplayName,
  saveDisplayName: (...args: unknown[]) => mockUpdate(...args),
}));
jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({ status: 'signedIn', session: { user: { id: 'user-1' } } }),
}));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({ state: { status: 'none' }, refresh: mockRefresh }),
}));
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', regionCode: mockRegionCode }],
}));
jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => store.get(key) ?? null,
      setItemSync: (key: string, value: string) => void store.set(key, value),
      removeItemSync: (key: string) => store.delete(key),
      getAllKeys: async () => [...store.keys()],
      removeItem: async (key: string) => void store.delete(key),
    },
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const wrap = (node: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <OnboardingDraftProvider>{node}</OnboardingDraftProvider>
  </SafeAreaProvider>
);

beforeEach(async () => {
  await clearAllDrafts();
  jest.clearAllMocks();
  mockDisplayName = null;
  mockRegionCode = 'US';
  mockRpc.mockResolvedValue({ data: 'household-1', error: null });
  mockUpdate.mockResolvedValue(undefined);
  mockRefresh.mockResolvedValue(undefined);
});

describe('S-05 create or join (FR-ONB-1, FR-AUTH-4)', () => {
  it('asks for a name when the profile has none, then saves it and moves on', async () => {
    await render(wrap(<WelcomeScreen />));
    expect(await screen.findByTestId('welcome-name')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('welcome-create'));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId('welcome-name-error')).toHaveTextContent(/Enter a name/);

    await fireEvent.changeText(screen.getByTestId('welcome-name'), ' Sam ');
    await fireEvent.press(screen.getByTestId('welcome-create'));
    expect(mockUpdate).toHaveBeenCalledWith('user-1', 'Sam');
    expect(router.push).toHaveBeenCalledWith('/create-household');
    // The step is saved, so a restart resumes here (FR-ONB-7).
    expect(readOnboardingStep()).toBe('create-household');
  });

  it('greets a user who already has a name and asks only for the choice', async () => {
    mockDisplayName = 'Alex';
    await render(wrap(<WelcomeScreen />));
    expect(await screen.findByTestId('welcome-screen-title')).toHaveTextContent('Welcome, Alex');
    expect(screen.queryByTestId('welcome-name')).toBeNull();
    await fireEvent.press(screen.getByTestId('welcome-join'));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/join');
  });
});

describe('S-06 name and region (FR-ONB-2, FR-ONB-3)', () => {
  it('creates the household with the region settings and the device time zone', async () => {
    mockRegionCode = 'GB';
    await render(wrap(<CreateHouseholdScreen displayName="Sam" />));
    expect(screen.getByTestId('household-name').props.value).toBe("Sam's home");
    expect(screen.getByTestId('region-GB')).toBeChecked();

    await fireEvent.press(screen.getByTestId('region-AU'));
    await fireEvent.press(screen.getByTestId('create-household-continue'));

    expect(mockRpc).toHaveBeenCalledWith('create_household', {
      name: "Sam's home",
      region: 'AU',
      locale: 'en-AU',
      unit_system: 'metric',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      week_start: 1,
    });
    expect(mockRefresh).toHaveBeenCalled();
    // Done: the draft is cleared.
    expect(readOnboardingStep()).toBe('welcome');
  });

  it('keeps edited answers in the draft, so they survive a restart (FR-ONB-7)', async () => {
    const first = await render(wrap(<CreateHouseholdScreen displayName="Sam" />));
    await fireEvent.changeText(screen.getByTestId('household-name'), 'The Burrow');
    await fireEvent.press(screen.getByTestId('region-AU'));
    await first.unmount();

    await render(wrap(<CreateHouseholdScreen displayName="Sam" />));
    expect(screen.getByTestId('household-name').props.value).toBe('The Burrow');
    expect(screen.getByTestId('region-AU')).toBeChecked();
  });

  it('requires a household name and shows server errors', async () => {
    await render(wrap(<CreateHouseholdScreen displayName={null} />));
    expect(screen.getByTestId('household-name').props.value).toBe('Our home');
    await fireEvent.changeText(screen.getByTestId('household-name'), '  ');
    await fireEvent.press(screen.getByTestId('create-household-continue'));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.getByTestId('household-name-error')).toHaveTextContent(/Give your household/);

    await fireEvent.changeText(screen.getByTestId('household-name'), 'Home');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await fireEvent.press(screen.getByTestId('create-household-continue'));
    expect(screen.getByTestId('household-name-error')).toHaveTextContent(/Something went wrong/);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('treats an existing membership as done', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'already a member', hint: 'household.already_member' },
    });
    await render(wrap(<CreateHouseholdScreen displayName="Sam" />));
    await fireEvent.press(screen.getByTestId('create-household-continue'));
    expect(mockRefresh).toHaveBeenCalled();
  });
});
