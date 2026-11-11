import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AllergiesScreen } from '@/features/onboarding/allergies-screen';
import { CreateHouseholdScreen } from '@/features/onboarding/create-household-screen';
import { OnboardingDraftProvider, readOnboardingStep } from '@/features/onboarding/draft';
import { PeopleScreen } from '@/features/onboarding/people-screen';
import { WelcomeScreen } from '@/features/onboarding/welcome-screen';
import { dueMonthOptions } from '@/features/people/codes';
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
  it('saves the name and region and moves on to step 3 without creating anything yet', async () => {
    mockRegionCode = 'GB';
    await render(wrap(<CreateHouseholdScreen displayName="Sam" />));
    expect(screen.getByTestId('household-name').props.value).toBe("Sam's home");
    expect(screen.getByTestId('region-GB')).toBeChecked();

    await fireEvent.press(screen.getByTestId('region-AU'));
    await fireEvent.press(screen.getByTestId('create-household-continue'));

    expect(mockRpc).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/people');
    expect(readOnboardingStep()).toBe('people');
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

  it('requires a household name', async () => {
    await render(wrap(<CreateHouseholdScreen displayName={null} />));
    expect(screen.getByTestId('household-name').props.value).toBe('Our home');
    await fireEvent.changeText(screen.getByTestId('household-name'), '  ');
    await fireEvent.press(screen.getByTestId('create-household-continue'));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId('household-name-error')).toHaveTextContent(/Give your household/);
  });
});

/** Runs S-06 with the given region, then shows S-07, S-08 or both in one draft. */
async function throughStepTwo(region: 'US' | 'GB' | 'AU' = 'US') {
  const first = await render(wrap(<CreateHouseholdScreen displayName="Sam" />));
  await fireEvent.press(screen.getByTestId(`region-${region}`));
  await fireEvent.press(screen.getByTestId('create-household-continue'));
  await first.unmount();
}

const steps = (displayName: string | null = 'Sam') => (
  <>
    <PeopleScreen displayName={displayName} />
    <AllergiesScreen displayName={displayName} />
  </>
);

describe('S-07 and S-08 people, allergies and finishing (FR-ONB-2, FR-ONB-4, FR-ONB-5)', () => {
  it('asks "expecting, or how old is your youngest?" and stores the due month only (D-6)', async () => {
    await throughStepTwo('GB');
    await render(wrap(steps()));
    expect(screen.getByTestId('adult-0-name').props.placeholder).toBe('Sam');
    expect(screen.getByText('Expecting, or how old is your youngest?')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('add-child-expecting'));
    const month = dueMonthOptions(new Date())[3];
    await fireEvent.press(screen.getByTestId(`child-0-due-${month}`));
    await fireEvent.press(screen.getByTestId('add-child-toddler'));
    await fireEvent.changeText(screen.getByTestId('child-1-name'), 'Mo');
    await fireEvent.press(screen.getByTestId('add-adult'));
    await fireEvent.changeText(screen.getByTestId('adult-1-name'), 'Alex');
    await fireEvent.press(screen.getByTestId('people-continue'));
    expect(router.push).toHaveBeenCalledWith('/allergies');
    expect(readOnboardingStep()).toBe('allergies');

    // S-08 shows the disclaimer, and no allergy chips for someone not yet born.
    expect(screen.getByTestId('allergy-disclaimer')).toHaveTextContent(/isn't medical advice/);
    expect(screen.queryByTestId('dietary-3')).toBeNull();
    // Order on S-08: Sam, Mo (toddler), Alex.
    await fireEvent.press(screen.getByTestId('dietary-1-allergen.peanut'));
    await fireEvent.press(screen.getByTestId('dietary-0-diet.vegetarian'));
    await fireEvent.press(screen.getByTestId('allergies-finish'));

    expect(mockRpc).toHaveBeenCalledWith('complete_onboarding', {
      name: "Sam's home",
      region: 'GB',
      locale: 'en-GB',
      unit_system: 'metric',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      week_start: 1,
      people: [
        {
          display_name: 'Sam',
          age_band: 'adult',
          due_month: null,
          is_self: true,
          allergies: [],
          diets: ['diet.vegetarian'],
        },
        {
          display_name: 'Baby',
          age_band: 'expecting',
          due_month: month,
          is_self: false,
          allergies: [],
          diets: [],
        },
        {
          display_name: 'Mo',
          age_band: 'toddler',
          due_month: null,
          is_self: false,
          allergies: ['allergen.peanut'],
          diets: [],
        },
        {
          display_name: 'Alex',
          age_band: 'adult',
          due_month: null,
          is_self: false,
          allergies: [],
          diets: [],
        },
      ],
    });
    // Nothing that looks like a full date was sent.
    expect(JSON.stringify(mockRpc.mock.calls[0][1])).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(mockRefresh).toHaveBeenCalled();
    expect(readOnboardingStep()).toBe('welcome');
  });

  it('skipping both steps creates the household with just the user', async () => {
    await throughStepTwo();
    await render(wrap(steps()));
    await fireEvent.press(screen.getByTestId('add-child-toddler'));
    await fireEvent.press(screen.getByTestId('people-skip'));
    await fireEvent.press(screen.getByTestId('dietary-0-allergen.egg'));
    await fireEvent.press(screen.getByTestId('allergies-skip'));
    expect(mockRpc).toHaveBeenCalledWith(
      'complete_onboarding',
      expect.objectContaining({
        region: 'US',
        week_start: 7,
        people: [
          {
            display_name: 'Sam',
            age_band: 'adult',
            due_month: null,
            is_self: true,
            allergies: [],
            diets: [],
          },
        ],
      }),
    );
  });

  it('keeps people and allergies in the draft across a restart (FR-ONB-7)', async () => {
    await throughStepTwo();
    const first = await render(wrap(steps()));
    await fireEvent.press(screen.getByTestId('add-child-infant_6_12m'));
    await fireEvent.press(screen.getByTestId('dietary-1-allergen.milk'));
    await first.unmount();

    await render(wrap(steps()));
    expect(screen.getByTestId('child-0-band-infant_6_12m').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByTestId('dietary-1-allergen.milk').props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('shows server errors and keeps the answers', async () => {
    await throughStepTwo();
    await render(wrap(steps()));
    await fireEvent.press(screen.getByTestId('people-continue'));
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await fireEvent.press(screen.getByTestId('allergies-finish'));
    expect(screen.getByTestId('allergies-error')).toHaveTextContent(/Something went wrong/);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(readOnboardingStep()).toBe('allergies');
  });

  it('treats an existing membership as done', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'already a member', hint: 'household.already_member' },
    });
    await throughStepTwo();
    await render(wrap(steps()));
    await fireEvent.press(screen.getByTestId('allergies-finish'));
    expect(mockRefresh).toHaveBeenCalled();
  });
});
