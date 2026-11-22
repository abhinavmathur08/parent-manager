import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { RadioOption } from '@/components/radio-option';
import { SectionHeader } from '@/components/section-header';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { authenticate } from '@/features/biometric/device-auth';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber } from '@/i18n';

import { VAULT_TIMEOUTS, type VaultLockSettings } from './vault-lock-policy';
import { readVaultSettings, writeVaultSettings } from './vault-lock-store';

/**
 * The "Documents" settings (FR2-PRIV-3): the vault lock and its timeout, on this device only.
 * Turning it off needs a check first (FR2-DOC-3). Always free.
 */
export function VaultLockSettingsSection() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [settings, setSettings] = useState(readVaultSettings);
  const [message, setMessage] = useState<string>();

  function save(next: VaultLockSettings) {
    setSettings(next);
    writeVaultSettings(next);
  }

  async function toggle(enabled: boolean) {
    setMessage(undefined);
    if (enabled) return save({ ...settings, enabled: true });
    const result = await authenticate(t('vault.turnOffPrompt'), t('vault.cancel')).catch(
      () => 'cancelled' as const,
    );
    if (result === 'unlocked') save({ ...settings, enabled: false });
    else if (result === 'unavailable') setMessage(t('vault.noPasscodeBody'));
  }

  return (
    <View style={{ gap: theme.space[2] }}>
      <SectionHeader title={t('vault.settingsTitle')} variant="group" />
      <Switch
        label={t('vault.setting')}
        description={t('vault.settingDescription')}
        value={settings.enabled}
        onValueChange={toggle}
        testID="vault-lock-switch"
      />
      {message ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="vault-lock-message">
          {message}
        </Text>
      ) : null}
      {settings.enabled ? (
        <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
          <Text variant="label" color="textSecondary">
            {t('vault.timeoutTitle')}
          </Text>
          {VAULT_TIMEOUTS.map((minutes) => (
            <RadioOption
              key={minutes}
              label={
                minutes === 0
                  ? t('vault.timeoutImmediately')
                  : t('vault.timeoutMinutes', {
                      count: minutes,
                      minutes: formatNumber(minutes, i18n.language),
                    })
              }
              selected={settings.timeoutMinutes === minutes}
              onPress={() => save({ ...settings, timeoutMinutes: minutes })}
              testID={`vault-timeout-${minutes}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
