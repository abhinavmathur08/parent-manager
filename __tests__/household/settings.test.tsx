import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { withRegion } from '@/features/household/settings';
import { HouseholdSettingsScreen } from '@/features/household/settings-screen';

const mockUpdate = jest.fn();
const mockRefresh = jest.fn();
let mockRole = 'parent';

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () => ({
        data: {
          name: 'Our home',
          region: 'US',
          unit_system: 'us_customary',
          timezone: 'America/New_York',
          week_start: 7,
        },
        error: null,
      });
      chain.update = (values: unknown) => {
        mockUpdate(values);
        return {
          eq: () => ({ select: async () => ({ data: [{ id: 'h1' }], error: null }) }),
        };
      };
      return chain;
    },
  }),
}));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: {
      status: 'member',
      membership: { householdId: 'h1', role: mockRole, region: 'US', locale: 'en-US' },
    },
    refresh: mockRefresh,
  }),
}));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
jest.mock('@/features/household/region', () => ({
  ...jest.requireActual('@/features/household/region'),
  deviceTimeZone: () => 'America/New_York',
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <HouseholdSettingsScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'parent';
  mockRefresh.mockResolvedValue(undefined);
});

describe('household settings (FR-HH-15)', () => {
  it('resets units and week start to the new region, which can then be changed', () => {
    const us = {
      name: 'Home',
      region: 'US' as const,
      unitSystem: 'us_customary' as const,
      timezone: 'UTC',
      weekStart: 7 as const,
    };
    expect(withRegion(us, 'GB')).toMatchObject({ unitSystem: 'metric', weekStart: 1 });
  });

  it('saves a new region and reloads the membership so units re-display', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('settings-region-GB'));
    expect(screen.getByTestId('settings-units-metric')).toBeChecked();
    await fireEvent.press(screen.getByTestId('settings-save'));
    expect(mockUpdate).toHaveBeenCalledWith({
      name: 'Our home',
      region: 'GB',
      locale: 'en-GB',
      unit_system: 'metric',
      timezone: 'America/New_York',
      week_start: 1,
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(await screen.findByText('Settings saved.')).toBeOnTheScreen();
  });

  it('shows each unit system with an example', async () => {
    await renderScreen();
    expect(await screen.findByTestId('settings-units-us_customary')).toHaveAccessibleName(
      /US cups/,
    );
  });

  it('is read-only for anyone but a parent', async () => {
    mockRole = 'family';
    await renderScreen();
    expect(await screen.findByTestId('settings-read-only')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-region-GB')).toBeDisabled();
    expect(screen.queryByTestId('settings-save')).toBeNull();
  });
});
