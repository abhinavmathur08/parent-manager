import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HouseholdHubScreen } from '@/features/household/hub-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (href: string) => mockPush(href) },
  useFocusEffect: jest.fn(),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe('Household tab (S-25, FR-PRIV-1)', () => {
  it.each([
    ['members', '/household/members'],
    ['people', '/household/people'],
    ['settings', '/household/settings'],
    ['privacy', '/household/privacy'],
    ['account', '/household/account'],
  ])('opens %s', async (key, href) => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <HouseholdHubScreen />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByTestId(`open-${key}`));
    expect(mockPush).toHaveBeenLastCalledWith(href);
  });
});
