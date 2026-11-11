import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { RadioOption } from '@/components/radio-option';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { authErrorKey } from '@/features/auth/auth-errors';
import { useHousehold } from '@/features/household/membership';
import { deviceTimeZone, REGION_SETTINGS, REGIONS } from '@/features/household/region';
import {
  fetchHouseholdSettings,
  saveHouseholdSettings,
  withRegion,
  type HouseholdSettings,
} from '@/features/household/settings';
import { MAX_HOUSEHOLD_NAME } from '@/features/onboarding/create-household';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { displayQuantity, formatDate, formatQuantity, type UnitSystem } from '@/i18n';

// A pint of milk in base millilitres, and a Sunday and a Monday, for the previews.
const EXAMPLE_ML = 473;
const DAY: Record<1 | 7, Date> = {
  7: new Date(Date.UTC(2026, 10, 8, 12)),
  1: new Date(Date.UTC(2026, 10, 9, 12)),
};
const UNIT_SYSTEMS: readonly UnitSystem[] = ['us_customary', 'metric'];

/** Household settings: name, region, units, time zone and week start (FR-HH-15). */
export function HouseholdSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const { state, refresh } = useHousehold();
  const membership = state.status === 'member' ? state.membership : null;
  const householdId = membership?.householdId ?? null;
  const canEdit = membership?.role === 'parent';
  const [settings, setSettings] = useState<HouseholdSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const device = deviceTimeZone();

  useEffect(() => {
    if (!householdId) return;
    let current = true;
    fetchHouseholdSettings(householdId)
      .then((loaded) => current && setSettings(loaded))
      .catch(() => current && setLoadFailed(true));
    return () => {
      current = false;
    };
  }, [householdId]);

  const update = (next: HouseholdSettings) => {
    setSettings(next);
    setMessage(undefined);
  };

  async function save() {
    if (!householdId || !settings) return;
    if (settings.name.trim() === '') {
      setMessage({ text: t('onboarding.household.nameRequired'), error: true });
      return;
    }
    setSaving(true);
    try {
      await saveHouseholdSettings(householdId, settings);
      // The new region and units show everywhere once the membership reloads.
      await refresh();
      setMessage({ text: t('household.settings.saved'), error: false });
    } catch (caught) {
      setMessage({ text: t(`auth.errors.${authErrorKey(caught)}`), error: true });
    } finally {
      setSaving(false);
    }
  }

  const locale = settings ? REGION_SETTINGS[settings.region].locale : 'en-US';
  const disabled = !canEdit || saving;

  return (
    <Screen
      title={t('household.settings.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
      testID="settings-screen"
      banner={
        online ? null : (
          <Banner
            variant="offline"
            message={t('household.settings.offline')}
            testID="offline-banner"
          />
        )
      }
    >
      {canEdit ? null : (
        <Text color="textSecondary" testID="settings-read-only">
          {t('household.settings.parentsOnly')}
        </Text>
      )}
      {loadFailed ? <Text testID="settings-error">{t('auth.errors.network')}</Text> : null}
      {settings ? (
        <>
          <TextField
            label={t('onboarding.household.name')}
            value={settings.name}
            onChangeText={(name) => update({ ...settings, name })}
            maxLength={MAX_HOUSEHOLD_NAME}
            disabled={disabled}
            testID="settings-name"
          />
          <SectionHeader title={t('household.settings.region')} variant="group" />
          <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
            {REGIONS.map((region) => (
              <RadioOption
                key={region}
                label={t(`onboarding.region.${region}`)}
                selected={settings.region === region}
                onPress={() => update(withRegion(settings, region))}
                disabled={disabled}
                testID={`settings-region-${region}`}
              />
            ))}
          </View>
          <SectionHeader title={t('household.settings.units')} variant="group" />
          <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
            {UNIT_SYSTEMS.map((system) => (
              <RadioOption
                key={system}
                label={t(`household.settings.unitSystem.${system}`)}
                description={t('household.settings.unitExample', {
                  example: formatQuantity(
                    displayQuantity(EXAMPLE_ML, 'volume', system, { liquid: true }),
                    locale,
                  ),
                })}
                selected={settings.unitSystem === system}
                onPress={() => update({ ...settings, unitSystem: system })}
                disabled={disabled}
                testID={`settings-units-${system}`}
              />
            ))}
          </View>
          <SectionHeader title={t('household.settings.weekStart')} variant="group" />
          <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
            {([7, 1] as const).map((day) => (
              <RadioOption
                key={day}
                label={formatDate(DAY[day], locale, { weekday: 'long', timeZone: 'UTC' })}
                selected={settings.weekStart === day}
                onPress={() => update({ ...settings, weekStart: day })}
                disabled={disabled}
                testID={`settings-week-${day}`}
              />
            ))}
          </View>
          <SectionHeader title={t('household.settings.timezone')} variant="group" />
          <Text testID="settings-timezone">{settings.timezone}</Text>
          {canEdit && device !== settings.timezone ? (
            <Button
              variant="secondary"
              label={t('household.settings.useDeviceTimezone', { timezone: device })}
              onPress={() => update({ ...settings, timezone: device })}
              disabled={disabled}
              testID="settings-use-device-timezone"
            />
          ) : null}
          {message ? (
            <Text
              color={message.error ? 'error' : 'success'}
              accessibilityLiveRegion="polite"
              testID="settings-message"
            >
              {message.text}
            </Text>
          ) : null}
          {canEdit ? (
            <Button
              label={t('household.settings.save')}
              onPress={save}
              loading={saving}
              disabled={!online || saving}
              fullWidth
              testID="settings-save"
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
