import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Stepper } from '@/components/stepper';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber, type AppLocale } from '@/i18n';

import {
  canHaveBabyPlate,
  portionsFor,
  servingsFromPortions,
  type PersonPortion,
  type PlanPerson,
} from './plan';
import {
  BABY_PLATE_PORTION,
  PORTIONS,
  type PlanEntryPortionRow,
  type PlanEntryRow,
} from './tables';

const MAX_SERVINGS = 24;

export type EntryChange =
  | { kind: 'portions'; portions: ReadonlyMap<string, PersonPortion> }
  | { kind: 'servings'; servings: number };

/**
 * S-12, entry detail (FR-PLAN-5, FR-PLAN-6): servings, and portions per person: 0 (not
 * eating), ½, 1 or 2, or a baby plate (¼) for someone 6 to 12 months old. Each person starts
 * on the portion set on the entry or their R-SERV-1 default. Changing a portion makes the
 * servings their sum (R-SERV-2); the stepper can still set servings directly.
 */
export function EntrySheet({
  entry,
  title,
  people,
  peopleStatus,
  portionRows,
  locale,
  canWrite,
  onSave,
  onClose,
}: {
  entry: PlanEntryRow | null;
  title: string;
  people: readonly PlanPerson[];
  peopleStatus: 'loading' | 'ready' | 'unavailable';
  portionRows: readonly PlanEntryPortionRow[];
  locale: AppLocale;
  canWrite: boolean;
  onSave: (entry: PlanEntryRow, change: EntryChange) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={entry !== null} onClose={onClose} title={title} testID="entry-sheet">
      {entry ? (
        <Body
          key={`${entry.id}-${people.length}`}
          entry={entry}
          people={people}
          peopleStatus={peopleStatus}
          portionRows={portionRows}
          locale={locale}
          canWrite={canWrite}
          onSave={onSave}
        />
      ) : null}
    </BottomSheet>
  );
}

function Body({
  entry,
  people,
  peopleStatus,
  portionRows,
  locale,
  canWrite,
  onSave,
}: {
  entry: PlanEntryRow;
  people: readonly PlanPerson[];
  peopleStatus: 'loading' | 'ready' | 'unavailable';
  portionRows: readonly PlanEntryPortionRow[];
  locale: AppLocale;
  canWrite: boolean;
  onSave: (entry: PlanEntryRow, change: EntryChange) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [portions, setPortions] = useState(() => portionsFor(entry.id, people, portionRows));
  const [servings, setServings] = useState(entry.servings);
  const [portionsChanged, setPortionsChanged] = useState(false);
  const free = !entry.recipe_id;
  const number = (value: number) => formatNumber(value, locale, { maximumFractionDigits: 2 });

  const choose = (personId: string, value: PersonPortion) => {
    const next = new Map(portions);
    next.set(personId, value);
    setPortions(next);
    setPortionsChanged(true);
    const total = servingsFromPortions(next.values());
    if (total !== null) setServings(total);
  };
  const nobodyEats = portionsChanged && servingsFromPortions(portions.values()) === null;
  const changed = portionsChanged || servings !== entry.servings;

  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textSecondary">
          {t('plan.entry.servings')}
        </Text>
        <Stepper
          value={servings}
          onChange={(value) => {
            setServings(value);
            setPortionsChanged(false);
          }}
          min={0.5}
          max={MAX_SERVINGS}
          step={0.5}
          accessibilityLabel={t('plan.entry.servings')}
          formatValue={number}
          testID="entry-servings"
        />
        {free ? (
          <Text variant="caption" color="textSecondary">
            {t('plan.entry.freeTextNote')}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: theme.space[3] }}>
        <Text variant="label" color="textSecondary">
          {t('plan.entry.portions')}
        </Text>
        {peopleStatus === 'unavailable' ? (
          <Text color="textSecondary" testID="entry-people-unavailable">
            {t('plan.entry.peopleUnavailable')}
          </Text>
        ) : null}
        {people.map((person, i) => {
          const current = portions.get(person.id);
          const babyPlate = current?.variant === 'baby_plate';
          return (
            <View key={person.id} style={{ gap: theme.space[2] }} testID={`entry-person-${i}`}>
              <Text variant="bodyStrong">
                {t('plan.entry.person', {
                  name: person.displayName,
                  band: t(`people.ageBands.${person.ageBand}`),
                })}
              </Text>
              <View style={[styles.wrap, { gap: theme.space[2] }]}>
                {PORTIONS.map((value) => (
                  <Chip
                    key={value}
                    label={value === 0 ? t('plan.entry.notEating') : number(value)}
                    selected={!babyPlate && current?.portions === value}
                    disabled={!canWrite}
                    onPress={() => choose(person.id, { portions: value, variant: 'standard' })}
                    testID={`entry-person-${i}-portion-${value * 2}`}
                  />
                ))}
                {canHaveBabyPlate(person.ageBand) ? (
                  <Chip
                    label={t('plan.entry.babyPlate')}
                    selected={babyPlate}
                    disabled={!canWrite}
                    onPress={() =>
                      choose(person.id, { portions: BABY_PLATE_PORTION, variant: 'baby_plate' })
                    }
                    testID={`entry-person-${i}-baby-plate`}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {nobodyEats ? (
        <Text color="error" testID="entry-nobody-eats">
          {t('plan.entry.nobodyEats')}
        </Text>
      ) : null}
      {canWrite ? (
        <Button
          label={t('plan.entry.save')}
          onPress={() =>
            onSave(
              entry,
              portionsChanged ? { kind: 'portions', portions } : { kind: 'servings', servings },
            )
          }
          disabled={!changed || nobodyEats}
          fullWidth
          testID="entry-save"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
