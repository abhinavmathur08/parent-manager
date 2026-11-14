import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, type AppLocale } from '@/i18n';

import { SLOTS, type PlanEntryRow, type Slot } from './tables';
import { toDate, type PlanDate } from './week';

export type EntryTarget = { date: PlanDate; slot: Slot };

/**
 * Long-press actions on an entry (FR-PLAN-7): pick a day of the shown week and a slot, then
 * move or duplicate the entry there; or remove it, with an undo bar afterwards.
 */
export function EntryActionsSheet({
  entry,
  title,
  days,
  locale,
  onMove,
  onDuplicate,
  onRemove,
  onClose,
}: {
  entry: PlanEntryRow | null;
  title: string;
  /** The shown week's dates. */
  days: readonly PlanDate[];
  locale: AppLocale;
  onMove: (entry: PlanEntryRow, target: EntryTarget) => void;
  onDuplicate: (entry: PlanEntryRow, target: EntryTarget) => void;
  onRemove: (entry: PlanEntryRow) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={entry !== null} onClose={onClose} title={title} testID="entry-actions">
      {entry ? (
        <Body
          key={entry.id}
          entry={entry}
          days={days}
          locale={locale}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      ) : null}
    </BottomSheet>
  );
}

function Body({
  entry,
  days,
  locale,
  onMove,
  onDuplicate,
  onRemove,
}: {
  entry: PlanEntryRow;
  days: readonly PlanDate[];
  locale: AppLocale;
  onMove: (entry: PlanEntryRow, target: EntryTarget) => void;
  onDuplicate: (entry: PlanEntryRow, target: EntryTarget) => void;
  onRemove: (entry: PlanEntryRow) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  // An entry from another week starts on the first day shown.
  const [date, setDate] = useState(days.includes(entry.date) ? entry.date : days[0]);
  const [slot, setSlot] = useState<Slot>(entry.slot);
  const unchanged = date === entry.date && slot === entry.slot;

  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textSecondary">
          {t('plan.actions.day')}
        </Text>
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          {days.map((day, i) => (
            <Chip
              key={day}
              label={formatDate(toDate(day), locale, { weekday: 'short', timeZone: 'UTC' })}
              selected={day === date}
              onPress={() => setDate(day)}
              testID={`entry-actions-day-${i}`}
            />
          ))}
        </View>
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textSecondary">
          {t('plan.actions.slot')}
        </Text>
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          {SLOTS.map((s) => (
            <Chip
              key={s}
              label={t(`plan.slots.${s}`)}
              selected={s === slot}
              onPress={() => setSlot(s)}
              testID={`entry-actions-slot-${s}`}
            />
          ))}
        </View>
      </View>
      <Button
        label={t('plan.actions.move')}
        onPress={() => onMove(entry, { date, slot })}
        disabled={unchanged}
        fullWidth
        testID="entry-actions-move"
      />
      <Button
        variant="secondary"
        label={t('plan.actions.duplicate')}
        onPress={() => onDuplicate(entry, { date, slot })}
        fullWidth
        testID="entry-actions-duplicate"
      />
      <Button
        variant="destructive"
        label={t('plan.actions.remove')}
        onPress={() => onRemove(entry)}
        fullWidth
        testID="entry-actions-remove"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
