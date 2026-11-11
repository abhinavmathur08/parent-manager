import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { nameKey, type AllergenCode } from '@/features/ingredients/catalog-ids';
import {
  ageBandKey,
  CHILD_AGE_BANDS,
  dietKey,
  DIET_CODES,
  dueMonthDate,
  dueMonthOptions,
  OFFERED_ALLERGEN_CODES,
  type AgeBand,
  type ChildAgeBand,
  type DietCode,
  type DueMonth,
} from '@/features/people/codes';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, type AppLocale } from '@/i18n';

/** Chips that wrap onto as many lines as the text needs. */
function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      <View style={[styles.wrap, { gap: theme.space[2] }]}>{children}</View>
    </View>
  );
}

/** An age band, from the fixed bands (D-6). Never a birth date (FR-ONB-4). */
export function AgeBandChips<B extends AgeBand = ChildAgeBand>({
  label,
  value,
  onChange,
  bands = CHILD_AGE_BANDS as unknown as readonly B[],
  disabled,
  testID,
}: {
  label: string;
  value: B | null;
  onChange: (band: B) => void;
  /** Children's bands unless given. */
  bands?: readonly B[];
  disabled?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  return (
    <ChipGroup label={label}>
      {bands.map((band) => (
        <Chip
          key={band}
          label={t(ageBandKey(band))}
          selected={value === band}
          onPress={() => onChange(band)}
          disabled={disabled}
          testID={`${testID}-${band}`}
        />
      ))}
    </ChipGroup>
  );
}

/** The due month for an expecting household, never a day (FR-ONB-4, D-6). Optional. */
export function DueMonthChips({
  value,
  onChange,
  locale,
  disabled,
  testID,
}: {
  value: DueMonth | null;
  onChange: (month: DueMonth | null) => void;
  locale: AppLocale;
  disabled?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => {
    const months = dueMonthOptions(new Date());
    // Keep a saved month that has already passed visible, so it can be seen and changed.
    return value && !months.includes(value) ? [value, ...months] : months;
  }, [value]);
  return (
    <ChipGroup label={t('people.dueMonth')}>
      {options.map((month) => (
        <Chip
          key={month}
          label={formatDate(dueMonthDate(month), locale, {
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })}
          selected={value === month}
          onPress={() => onChange(value === month ? null : month)}
          disabled={disabled}
          testID={`${testID}-${month}`}
        />
      ))}
    </ChipGroup>
  );
}

/** Allergies and diets from fixed codes (FR-HH-12). Free on every plan (FR-PAY-10). */
export function DietaryChips({
  allergies,
  diets,
  onToggleAllergy,
  onToggleDiet,
  disabled,
  testID,
}: {
  allergies: readonly AllergenCode[];
  diets: readonly DietCode[];
  onToggleAllergy: (code: AllergenCode) => void;
  onToggleDiet: (code: DietCode) => void;
  disabled?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  // A code outside the offered list (the rest of the UK and EU 14) stays visible if set.
  const allergyCodes = [
    ...OFFERED_ALLERGEN_CODES,
    ...allergies.filter((code) => !OFFERED_ALLERGEN_CODES.includes(code)),
  ];
  return (
    <>
      <ChipGroup label={t('people.allergies')}>
        {allergyCodes.map((code) => (
          <Chip
            key={code}
            label={t(nameKey(code))}
            selected={allergies.includes(code)}
            onPress={() => onToggleAllergy(code)}
            disabled={disabled}
            testID={`${testID}-${code}`}
          />
        ))}
      </ChipGroup>
      <ChipGroup label={t('people.dietsLabel')}>
        {DIET_CODES.map((code) => (
          <Chip
            key={code}
            label={t(dietKey(code))}
            selected={diets.includes(code)}
            onPress={() => onToggleDiet(code)}
            disabled={disabled}
            testID={`${testID}-${code}`}
          />
        ))}
      </ChipGroup>
    </>
  );
}

/** The not-medical-advice disclaimer, on every screen that edits or shows allergies (FR-HH-12). */
export function AllergyDisclaimer({ testID }: { testID: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View testID={testID} accessible style={[styles.row, { gap: theme.space[2] }]}>
      <Icon name="info" size="sm" color="textSecondary" />
      <Text variant="caption" color="textSecondary" style={styles.text}>
        {t('components.allergenNotice.disclaimer')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  text: { flex: 1 },
});
