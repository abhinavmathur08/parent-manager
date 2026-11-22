import * as ScreenCapture from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform, StyleSheet, View, type AppStateStatus } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { authenticate, unlockMethod } from '@/features/biometric/device-auth';
import { useTheme } from '@/hooks/use-theme';
import { suppressBreadcrumbs } from '@/lib/crash-reporting';

import { markVaultUnlocked, vaultNeedsUnlock } from './vault-lock-store';

type GateState = 'checking' | 'locked' | 'no_passcode' | 'unlocked';

/**
 * Wraps every vault screen (S-40, S-41, S-42). Nothing inside renders until the vault lock is
 * passed (FR2-DOC-3), and a device with no biometrics or passcode can't open it at all. While
 * mounted: screenshots and recordings are blocked (Android's FLAG_SECURE also blanks the app
 * switcher), iOS blurs the app switcher, the content is hidden while the app is away, and
 * Sentry keeps no breadcrumbs (FR2-DOC-4, NFR2-SEC-2, NFR2-SEC-3).
 */
export function VaultGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>('checking');
  const [busy, setBusy] = useState(false);
  const [away, setAway] = useState(false);
  const prompted = useRef(false);

  ScreenCapture.usePreventScreenCapture('vault');

  useEffect(() => {
    const restore = suppressBreadcrumbs();
    if (Platform.OS === 'ios')
      ScreenCapture.enableAppSwitcherProtectionAsync(1).catch(() => undefined);
    return () => {
      restore();
      if (Platform.OS === 'ios')
        ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => undefined);
    };
  }, []);

  const unlock = useCallback(async () => {
    setBusy(true);
    try {
      const result = await authenticate(t('vault.prompt'), t('vault.cancel'));
      if (result === 'unlocked') {
        markVaultUnlocked();
        setState('unlocked');
      } else if (result === 'unavailable') {
        setState('no_passcode');
      }
    } catch {
      // Stay locked; the button tries again.
    } finally {
      setBusy(false);
    }
  }, [t]);

  const check = useCallback(
    () =>
      unlockMethod()
        .catch(() => 'none' as const)
        .then((method) => {
          // FR2-DOC-3 (PROPOSED): no passcode, no vault, even with the lock turned off.
          if (method === 'none') return setState('no_passcode');
          if (!vaultNeedsUnlock()) return setState('unlocked');
          setState('locked');
          if (prompted.current) return;
          prompted.current = true;
          return unlock();
        }),
    [unlock],
  );

  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      setAway(next !== 'active');
      if (next === 'active') {
        prompted.current = false;
        check();
      }
    });
    return () => subscription.remove();
  }, [check]);

  if (state === 'unlocked' && !away) return <>{children}</>;
  return <VaultCover state={state} busy={busy} onUnlock={unlock} />;
}

function VaultCover({
  state,
  busy,
  onUnlock,
}: {
  state: GateState;
  busy: boolean;
  onUnlock: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const noPasscode = state === 'no_passcode';
  return (
    <View
      testID={noPasscode ? 'vault-no-passcode' : 'vault-locked'}
      style={[
        styles.root,
        { backgroundColor: theme.color.background, padding: theme.layout.screenMargin },
      ]}
    >
      <View style={[styles.center, { gap: theme.space[3] }]}>
        <Icon name="lock" size="lg" color="primary" />
        <Text variant="cardTitle" accessibilityRole="header" style={styles.centerText}>
          {noPasscode ? t('vault.noPasscodeTitle') : t('vault.lockedTitle')}
        </Text>
        <Text color="textSecondary" style={styles.centerText}>
          {noPasscode ? t('vault.noPasscodeBody') : t('vault.lockedBody')}
        </Text>
      </View>
      {state === 'locked' ? (
        <Button
          label={t('vault.unlock')}
          onPress={onUnlock}
          loading={busy}
          fullWidth
          testID="vault-unlock"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
});
