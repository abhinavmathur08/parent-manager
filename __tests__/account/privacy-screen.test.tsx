import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { policyUrlForLanguage } from '@/constants/policy-links';
import { PrivacyScreen } from '@/features/account/privacy-screen';

let mockOptedOut = false;
const mockSetOptOut = jest.fn(async (value: boolean) => {
  mockOptedOut = value;
});

jest.mock('@/lib/analytics', () => ({
  isAnalyticsOptedOut: () => mockOptedOut,
  setAnalyticsOptOut: (value: boolean) => mockSetOptOut(value),
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
      <PrivacyScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockOptedOut = false;
});

describe('privacy and data (S-30)', () => {
  it('turns analytics off and back on for this device (FR-PRIV-5)', async () => {
    await renderScreen();
    const sharing = screen.getByTestId('analytics-switch');
    expect(sharing).toBeChecked();
    await fireEvent.press(sharing);
    expect(mockSetOptOut).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('analytics-switch')).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('analytics-switch'));
    expect(mockSetOptOut).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('analytics-switch')).toBeChecked();
  });

  it('starts off on a device that opted out', async () => {
    mockOptedOut = true;
    await renderScreen();
    expect(screen.getByTestId('analytics-switch')).not.toBeChecked();
  });

  it('lists both policies, disabled until there is a site (FR-PRIV-6)', async () => {
    await renderScreen();
    for (const kind of ['privacy', 'terms']) {
      expect(screen.getByTestId(`privacy-policy-${kind}`)).toBeDisabled();
    }
  });

  it('links policies in the app language, falling back to the default locale', () => {
    const base = 'https://example.com/legal/';
    expect(policyUrlForLanguage('privacy', 'en-GB', base)).toBe(
      'https://example.com/legal/en-gb/privacy',
    );
    expect(policyUrlForLanguage('terms', 'fr-FR', base)).toBe(
      'https://example.com/legal/en-us/terms',
    );
    expect(policyUrlForLanguage('terms', 'en-AU', null)).toBeNull();
  });
});
