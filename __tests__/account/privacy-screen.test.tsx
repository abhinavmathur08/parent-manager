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
const mockShareExport = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/features/account/export', () => ({
  shareExport: (...args: unknown[]) => mockShareExport(...args),
}));
let mockOnline = true;
jest.mock('@/hooks/use-online', () => ({ useOnline: () => mockOnline }));
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
  mockOnline = true;
});

const renderFor = (isParent: boolean) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <PrivacyScreen household={{ id: 'hh', isParent }} />
    </SafeAreaProvider>,
  );

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

describe('data export (FR-PRIV-2, spec 2.2 rows 35 and 36)', () => {
  it('lets a parent export the household and their own data', async () => {
    await renderFor(true);
    await fireEvent.press(screen.getByTestId('privacy-export-household'));
    expect(mockShareExport).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'household', householdId: 'hh' }),
    );
    expect(screen.getByTestId('privacy-export-account')).toBeOnTheScreen();
  });

  it('lets other members export only their own data', async () => {
    await renderFor(false);
    expect(screen.queryByTestId('privacy-export-household')).toBeNull();
    await fireEvent.press(screen.getByTestId('privacy-export-account'));
    expect(mockShareExport).toHaveBeenCalledWith(expect.objectContaining({ scope: 'account' }));
  });

  it('is off offline, with the reason (NFR-OFF-2)', async () => {
    mockOnline = false;
    await renderFor(true);
    expect(screen.getByTestId('privacy-export-household')).toHaveTextContent(/offline/);
    await fireEvent.press(screen.getByTestId('privacy-export-household'));
    expect(mockShareExport).not.toHaveBeenCalled();
  });

  it('says when the export fails', async () => {
    mockShareExport.mockRejectedValueOnce(new Error('network'));
    await renderFor(false);
    await fireEvent.press(screen.getByTestId('privacy-export-account'));
    expect(await screen.findByTestId('privacy-export-error')).toBeOnTheScreen();
  });
});
