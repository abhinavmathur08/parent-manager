import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ForcedUpdateGate, storeUrlFor } from '@/features/remote-config/forced-update';
import { FeatureGate, RemoteConfigProvider } from '@/features/remote-config/provider';
import { i18n } from '@/i18n';
import {
  compareVersions,
  isBelowMinimum,
  parseRemoteConfig,
  readCachedKillSwitches,
  writeCachedKillSwitches,
} from '@/lib/remote-config';

type Row = { key: string; value: unknown };
let mockRows: Row[] = [];
let mockOffline = false;
const mockInKeys = jest.fn();

jest.mock('@/lib/supabase-config', () => ({
  supabaseConfig: { url: 'https://example.supabase.co', publishableKey: 'pk' },
}));

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        in: (column: string, keys: string[]) => {
          mockInKeys(table, column, keys);
          return {
            abortSignal: async () =>
              mockOffline
                ? { data: null, error: { message: 'Network request failed' } }
                : { data: mockRows, error: null },
          };
        },
      }),
    }),
  }),
}));

jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.4.0', android: { package: 'com.myparentmanager' } } },
}));

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function App() {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <RemoteConfigProvider>
        <ForcedUpdateGate>
          <Text testID="app">app</Text>
          <FeatureGate feature="ai_import">
            <Text testID="import-entry">import</Text>
          </FeatureGate>
        </ForcedUpdateGate>
      </RemoteConfigProvider>
    </SafeAreaProvider>
  );
}

/** Renders the app and lets the config fetch settle. */
async function launch() {
  const view = await render(<App />);
  await act(async () => undefined);
  return view;
}

const version = '1.4.0';

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

beforeEach(() => {
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (state: AppStateStatus) => void);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  mockRows = [];
  mockOffline = false;
  localStorage.clear();
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

describe('reading app_config (F-09)', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.3')).toBeLessThan(0);
    expect(isBelowMinimum('1.0.0', '1.0.1')).toBe(true);
    expect(isBelowMinimum('1.0.1', '1.0.1')).toBe(false);
    expect(isBelowMinimum(undefined, '9.0.0')).toBe(false);
    expect(isBelowMinimum('1.0.0', null)).toBe(false);
  });

  it('reads per-platform values and ignores malformed ones', () => {
    const config = parseRemoteConfig(
      [
        { key: 'app.minimum_version', value: { ios: '2.1.0', android: '2.0.0' } },
        { key: 'app.store_url', value: { ios: 'javascript:alert(1)', android: 'market://x' } },
        { key: 'app.kill_switches', value: { ai_import: true, 'export.pdf': 'yes', other: true } },
      ],
      'ios',
    );
    expect(config).toEqual({ minimumVersion: '2.1.0', storeUrl: null, disabled: ['ai_import'] });
    expect(parseRemoteConfig([{ key: 'app.minimum_version', value: '3.0' }], 'android')).toEqual({
      minimumVersion: '3.0',
      storeUrl: null,
      disabled: [],
    });
    expect(parseRemoteConfig([{ key: 'app.minimum_version', value: 'soon' }], 'ios')).toMatchObject(
      { minimumVersion: null },
    );
  });

  it('asks only for its own keys', async () => {
    await launch();
    expect(mockInKeys).toHaveBeenCalledWith('app_config', 'key', [
      'app.minimum_version',
      'app.store_url',
      'app.kill_switches',
    ]);
  });

  it('falls back to the Play listing on Android', () => {
    expect(storeUrlFor(null, 'android', 'com.myparentmanager')).toBe(
      'https://play.google.com/store/apps/details?id=com.myparentmanager',
    );
    expect(storeUrlFor(null, 'ios', 'com.myparentmanager')).toBeNull();
    expect(storeUrlFor('https://apps.apple.com/app/id1', 'ios', undefined)).toBe(
      'https://apps.apple.com/app/id1',
    );
  });
});

describe('forced update (S-01, NFR-REL-4)', () => {
  it('shows the update screen when the minimum version is raised, and removes it when lowered', async () => {
    mockRows = [
      { key: 'app.minimum_version', value: '999.0.0' },
      { key: 'app.store_url', value: { ios: 'https://apps.apple.com/app/id1' } },
    ];
    await launch();
    expect(screen.getByTestId('forced-update')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
    expect(screen.getByText(i18n.t('forcedUpdate.title'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('forced-update-action'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://apps.apple.com/app/id1');

    mockRows = [{ key: 'app.minimum_version', value: version }];
    await act(async () => {
      // Returning to the foreground reads the config again.
      for (const listener of appStateListeners) listener('active');
    });
    expect(screen.queryByTestId('forced-update')).toBeNull();
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('says where to update when there is no store link', async () => {
    mockRows = [{ key: 'app.minimum_version', value: '999.0.0' }];
    await launch();
    expect(screen.queryByTestId('forced-update-action')).toBeNull();
    expect(screen.getByText(i18n.t('forcedUpdate.noStore'))).toBeTruthy();
  });

  it('fails open offline', async () => {
    mockOffline = true;
    await launch();
    expect(screen.queryByTestId('forced-update')).toBeNull();
    expect(screen.getByTestId('app')).toBeTruthy();
  });
});

describe('kill switches (NFR-REL-4, AI-20)', () => {
  it('hides AI import entry points when the switch is on', async () => {
    mockRows = [{ key: 'app.kill_switches', value: { ai_import: true } }];
    await launch();
    expect(screen.queryByTestId('import-entry')).toBeNull();
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('shows them by default', async () => {
    await launch();
    expect(screen.getByTestId('import-entry')).toBeTruthy();
  });

  it('remembers switches for the next launch, even offline', async () => {
    mockRows = [{ key: 'app.kill_switches', value: { ai_import: true } }];
    (await launch()).unmount();
    expect(readCachedKillSwitches()).toEqual(['ai_import']);
    mockOffline = true;
    await launch();
    expect(screen.queryByTestId('import-entry')).toBeNull();
  });

  it('ignores a corrupt cache', () => {
    localStorage.setItem('remote_config.disabled', '{oops');
    expect(readCachedKillSwitches()).toEqual([]);
    writeCachedKillSwitches(['export.pdf']);
    expect(readCachedKillSwitches()).toEqual(['export.pdf']);
  });
});
