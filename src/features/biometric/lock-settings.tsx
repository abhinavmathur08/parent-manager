import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { RadioOption } from '@/components/radio-option';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { useLockSettings } from '@/features/biometric/biometric-lock';
import { authenticate, unlockMethod, type UnlockMethod } from '@/features/biometric/device-auth';
import { LOCK_TIMEOUTS } from '@/features/biometric/lock-policy';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber } from '@/i18n';

/** The lock switch and timeout (FR-AUTH-6). Lives on the Account screen (S-31) once it exists. */
export function LockSettingsSection() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { settings, setSettings } = useLockSettings();
  const [method, setMethod] = useState<UnlockMethod | null>(null);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    unlockMethod()
      .then((value) => active && setMethod(value))
      .catch(() => active && setMethod('none'));
    return () => {
      active = false;
    };
  }, []);

  async function toggle(enabled: boolean) {
    setMessage(undefined);
    if (!enabled) {
      setSettings({ ...settings, enabled: false });
      return;
    }
    const current = await unlockMethod().catch(() => 'none' as const);
    setMethod(current);
    if (current === 'none') {
      setMessage(t('biometric.needsPasscode'));
      return;
    }
    // Prove it works before relying on it.
    const result = await authenticate(t('biometric.confirmPrompt'), t('biometric.cancel'));
    if (result === 'unlocked') setSettings({ ...settings, enabled: true });
    else if (result === 'unavailable') setMessage(t('biometric.needsPasscode'));
  }

  const label =
    method === 'faceId'
      ? t('biometric.settingFaceId')
      : method === 'fingerprint'
        ? t('biometric.settingFingerprint')
        : t('biometric.setting');

  return (
    <View style={{ gap: theme.space[2] }}>
      <Switch
        label={label}
        description={t('biometric.settingDescription')}
        value={settings.enabled}
        onValueChange={toggle}
        disabled={method === null}
        testID="biometric-switch"
      />
      {message ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="biometric-message">
          {message}
        </Text>
      ) : null}
      {settings.enabled ? (
        <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
          <Text variant="label" color="textSecondary">
            {t('biometric.timeoutTitle')}
          </Text>
          {LOCK_TIMEOUTS.map((minutes) => (
            <RadioOption
              key={minutes}
              label={
                minutes === 0
                  ? t('biometric.timeoutImmediately')
                  : t('biometric.timeoutMinutes', {
                      count: minutes,
                      minutes: formatNumber(minutes, i18n.language),
                    })
              }
              selected={settings.timeoutMinutes === minutes}
              onPress={() => setSettings({ ...settings, timeoutMinutes: minutes })}
              testID={`biometric-timeout-${minutes}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
