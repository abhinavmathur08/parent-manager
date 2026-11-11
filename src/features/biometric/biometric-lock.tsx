import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';

import { Toast } from '@/components/toast';
import { LockScreen } from '@/features/biometric/lock-screen';
import { shouldLock, type LockSettings } from '@/features/biometric/lock-policy';
import {
  readBackgroundedAt,
  readLockSettings,
  writeBackgroundedAt,
  writeLockSettings,
} from '@/features/biometric/lock-store';

type LockContextValue = {
  settings: LockSettings;
  setSettings: (settings: LockSettings) => void;
};

const LockContext = createContext<LockContextValue>({
  settings: { enabled: false, timeoutMinutes: 5 },
  setSettings: () => undefined,
});

export function useLockSettings(): LockContextValue {
  return useContext(LockContext);
}

/**
 * Biometric lock (FR-AUTH-6, S-04) over a signed-in app. When the lock is on and the app
 * comes back after the timeout, or starts cold, the lock screen covers everything before any
 * household data shows. It covers the app in the app switcher too. Off, it never prompts.
 */
export function BiometricLock({ active, children }: { active: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [settings, setSettingsState] = useState(readLockSettings);
  const [locked, setLocked] = useState(() =>
    shouldLock(readLockSettings(), readBackgroundedAt(), Date.now()),
  );
  const [appState, setAppState] = useState<AppStateStatus>(
    () => (AppState.currentState as AppStateStatus | null) ?? 'active',
  );
  const [notice, setNotice] = useState(false);
  const settingsRef = useRef(settings);

  const setSettings = useCallback((next: LockSettings) => {
    settingsRef.current = next;
    setSettingsState(next);
    writeLockSettings(next);
    // Turning the lock on starts the clock now, so it doesn't lock at once.
    if (next.enabled) writeBackgroundedAt(Date.now());
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setAppState(next);
      if (next === 'background') {
        writeBackgroundedAt(Date.now());
      } else if (next === 'active') {
        if (shouldLock(settingsRef.current, readBackgroundedAt(), Date.now())) setLocked(true);
      }
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo(() => ({ settings, setSettings }), [settings, setSettings]);
  const away = appState === 'background' || appState === 'inactive';
  const showLock = active && settings.enabled && locked;
  // Hide the app in the app switcher's snapshot while the lock is on.
  const covered = active && settings.enabled && away;

  return (
    <LockContext.Provider value={value}>
      <View
        style={styles.fill}
        importantForAccessibility={showLock || covered ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={showLock || covered}
      >
        {children}
      </View>
      {showLock || covered ? (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen
            prompt={showLock && !away}
            onUnlocked={() => setLocked(false)}
            onUnavailable={() => {
              // No biometrics and no passcode any more: turn the lock off and say so.
              setSettings({ ...settingsRef.current, enabled: false });
              setLocked(false);
              setNotice(true);
            }}
          />
        </View>
      ) : null}
      <Toast
        visible={notice}
        variant="info"
        message={t('biometric.turnedOff')}
        onDismiss={() => setNotice(false)}
        testID="biometric-turned-off"
      />
    </LockContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
