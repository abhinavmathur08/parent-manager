import Constants from 'expo-constants';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { useOnline } from '@/hooks/use-online';
import {
  DEFAULT_CONFIG,
  fetchRemoteConfig,
  isBelowMinimum,
  readCachedKillSwitches,
  writeCachedKillSwitches,
  type KillSwitch,
  type RemoteConfig,
} from '@/lib/remote-config';
import { supabaseConfig } from '@/lib/supabase-config';

const RemoteConfigContext = createContext<RemoteConfig>(DEFAULT_CONFIG);

/**
 * Reads remote config at launch, on reconnecting and on returning to the foreground (F-09).
 * A failed read keeps what the app already has, so offline it opens as normal (fails open).
 */
export function RemoteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<RemoteConfig>(() => ({
    ...DEFAULT_CONFIG,
    disabled: readCachedKillSwitches(),
  }));
  const online = useOnline();

  const refresh = useCallback(() => {
    if (!supabaseConfig) return;
    const platform = Platform.OS === 'android' ? 'android' : 'ios';
    fetchRemoteConfig(platform).then(
      (next) => {
        writeCachedKillSwitches(next.disabled);
        setConfig(next);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (online) refresh();
  }, [online, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return <RemoteConfigContext.Provider value={config}>{children}</RemoteConfigContext.Provider>;
}

export function useRemoteConfig(): RemoteConfig {
  return useContext(RemoteConfigContext);
}

/** Whether a feature that can be turned off remotely is on (NFR-REL-4, AI-20). */
export function useFeatureEnabled(feature: KillSwitch): boolean {
  return !useRemoteConfig().disabled.includes(feature);
}

/**
 * Shows its children only while the feature is on. Wrap every entry point to AI import
 * (AI-20: manual entry stays) and each list export target.
 */
export function FeatureGate({ feature, children }: { feature: KillSwitch; children: ReactNode }) {
  return useFeatureEnabled(feature) ? children : null;
}

/** Whether this build is older than the minimum supported version (S-01). */
export function useUpdateRequired(): boolean {
  return isBelowMinimum(Constants.expoConfig?.version, useRemoteConfig().minimumVersion);
}
