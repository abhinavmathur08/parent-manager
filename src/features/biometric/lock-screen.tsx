import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { authenticate, unlockMethod, type UnlockMethod } from '@/features/biometric/device-auth';
import { useTheme } from '@/hooks/use-theme';

export type LockScreenProps = {
  /** Show the system prompt now (the app is in the foreground). */
  prompt: boolean;
  onUnlocked: () => void;
  onUnavailable: () => void;
};

/** S-04: the app is locked until Face ID, Touch ID, a fingerprint or the passcode unlocks it. */
export function LockScreen({ prompt, onUnlocked, onUnavailable }: LockScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [method, setMethod] = useState<UnlockMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const prompted = useRef(false);

  useEffect(() => {
    let active = true;
    unlockMethod()
      .then((value) => active && setMethod(value))
      .catch(() => active && setMethod('passcode'));
    return () => {
      active = false;
    };
  }, []);

  const unlock = useCallback(async () => {
    setBusy(true);
    try {
      const result = await authenticate(t('biometric.prompt'), t('biometric.cancel'));
      if (result === 'unlocked') onUnlocked();
      else if (result === 'unavailable') onUnavailable();
    } catch {
      // Stay locked; the button tries again.
    } finally {
      setBusy(false);
    }
  }, [onUnavailable, onUnlocked, t]);

  // Ask once, as soon as the lock screen is in front.
  useEffect(() => {
    if (!prompt || prompted.current) return;
    prompted.current = true;
    unlock();
  }, [prompt, unlock]);

  const label =
    method === 'faceId'
      ? t('biometric.unlockFaceId')
      : method === 'fingerprint'
        ? t('biometric.unlockFingerprint')
        : method === 'passcode' || method === 'none'
          ? t('biometric.unlockPasscode')
          : t('biometric.unlock');

  return (
    <View
      testID="lock-screen"
      style={[
        styles.root,
        {
          backgroundColor: theme.color.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + theme.space[6],
          paddingHorizontal: theme.layout.screenMargin,
        },
      ]}
    >
      <View style={[styles.center, { gap: theme.space[3] }]}>
        <View
          style={{
            padding: theme.space[5],
            borderRadius: theme.radius.sheet,
            backgroundColor: theme.color.surfaceAlt,
          }}
        >
          <Icon name="lock" size="lg" color="primary" />
        </View>
        <Text variant="cardTitle" accessibilityRole="header" style={styles.centerText}>
          {t('biometric.lockedTitle')}
        </Text>
        <Text color="textSecondary" style={styles.centerText}>
          {t('biometric.lockedBody')}
        </Text>
      </View>
      {prompt ? (
        <Button label={label} onPress={unlock} loading={busy} fullWidth testID="lock-unlock" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
});
