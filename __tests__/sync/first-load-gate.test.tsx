import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { i18n } from '@/i18n';
import type { SyncStatus } from '@/lib/sync/engine';
import { FirstLoadGate } from '@/lib/sync/first-load-gate';

let mockOpening = false;
let mockStatus: Partial<SyncStatus> = {};
const mockSync = jest.fn(async () => undefined);

jest.mock('@/lib/sync/provider', () => ({
  useSyncOpening: () => mockOpening,
  useSyncEngine: () => ({ sync: mockSync }),
  useSyncStatus: () => ({ state: 'idle', firstLoad: false, ...mockStatus }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const renderGate = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <FirstLoadGate>
        <Text testID="tabs">tabs</Text>
      </FirstLoadGate>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockOpening = false;
  mockStatus = {};
  jest.clearAllMocks();
});

describe('FirstLoadGate (A-01.3, FR-AUTH-8)', () => {
  it('shows the loading state while the local copy opens', async () => {
    mockOpening = true;
    await renderGate();
    expect(screen.getByTestId('first-load')).toBeTruthy();
    expect(screen.queryByTestId('tabs')).toBeNull();
  });

  it('shows the loading state while a new device downloads the household', async () => {
    mockStatus = { firstLoad: true, state: 'syncing' };
    await renderGate();
    expect(screen.getByText(i18n.t('sync.firstLoad.title'))).toBeTruthy();
    expect(screen.queryByTestId('tabs')).toBeNull();
  });

  it('says a new device needs a connection, and tries again', async () => {
    mockStatus = { firstLoad: true, state: 'offline' };
    await renderGate();
    expect(screen.getByText(i18n.t('sync.firstLoad.offlineTitle'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('first-load-retry'));
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('shows the tabs once the household is here', async () => {
    await renderGate();
    expect(screen.getByTestId('tabs')).toBeTruthy();
  });

  it('never blocks a device that already has the household, even offline', async () => {
    mockStatus = { firstLoad: false, state: 'offline' };
    await renderGate();
    expect(screen.getByTestId('tabs')).toBeTruthy();
  });
});
