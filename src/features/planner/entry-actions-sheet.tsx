import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, type AppLocale } from '@/i18n';

import { SLOTS, type PlanEntryRow, type Slot } from './tables';
import { toDate, type PlanDate } from './week';

export type EntryTarget = { date: PlanDate; slot: Slot };

/** Leftover links for the entry (P-04, FR-PLAN-8). */
export type EntryLeftovers = {
  /** The entry it's leftovers of, or null. */
  source: PlanEntryRow | null;
  /** Earlier entries it can be leftovers of, nearest first. */
  candidates: readonly PlanEntryRow[];
  /** Where and what an entry is, such as "Mon, Nov 16 · Dinner · Chili". */
  describe: (entry: PlanEntryRow) => { title: string; when: string };
  onLink: (entry: PlanEntryRow, source: PlanEntryRow) => void;
  onUnlink: (entry: PlanEntryRow) => void;
};

/**
 * Long-press actions on an entry (FR-PLAN-7): pick a day of the shown week and a slot, then
 * move or duplicate the entry there; mark it as leftovers of an earlier entry, or unlink it
 * (FR-PLAN-8); or remove it, with an undo bar afterwards.
 */
export function EntryActionsSheet({
  entry,
  title,
  days,
  locale,
  onMove,
  onDuplicate,
  onRemove,
  leftovers,
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
  leftovers?: EntryLeftovers;
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
          leftovers={leftovers}
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
  leftovers,
}: {
  entry: PlanEntryRow;
  days: readonly PlanDate[];
  locale: AppLocale;
  onMove: (entry: PlanEntryRow, target: EntryTarget) => void;
  onDuplicate: (entry: PlanEntryRow, target: EntryTarget) => void;
  onRemove: (entry: PlanEntryRow) => void;
  leftovers?: EntryLeftovers;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  // An entry from another week starts on the first day shown.
  const [date, setDate] = useState(days.includes(entry.date) ? entry.date : days[0]);
  const [slot, setSlot] = useState<Slot>(entry.slot);
  const unchanged = date === entry.date && slot === entry.slot;
  const [choosing, setChoosing] = useState(false);

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
      {leftovers ? (
        <LeftoversSection
          entry={entry}
          leftovers={leftovers}
          choosing={choosing}
          onChoose={() => setChoosing(true)}
        />
      ) : null}
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

function LeftoversSection({
  entry,
  leftovers,
  choosing,
  onChoose,
}: {
  entry: PlanEntryRow;
  leftovers: EntryLeftovers;
  choosing: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { source, candidates, describe } = leftovers;

  if (source) {
    const { title, when } = describe(source);
    return (
      <View style={{ gap: theme.space[2] }}>
        <Text color="textSecondary" testID="entry-actions-leftovers-of">
          {t('plan.leftovers.of', { title, when })}
        </Text>
        <Button
          variant="secondary"
          label={t('plan.leftovers.unlink')}
          onPress={() => leftovers.onUnlink(entry)}
          fullWidth
          testID="entry-actions-unlink"
        />
      </View>
    );
  }
  if (!choosing) {
    return (
      <Button
        variant="secondary"
        label={t('plan.leftovers.mark')}
        onPress={onChoose}
        fullWidth
        testID="entry-actions-leftovers"
      />
    );
  }
  return (
    <View style={{ gap: theme.space[2] }} testID="entry-leftover-options">
      <Text variant="label" color="textSecondary">
        {t('plan.leftovers.choose')}
      </Text>
      {candidates.length === 0 ? (
        <Text color="textSecondary" testID="entry-leftover-none">
          {t('plan.leftovers.none')}
        </Text>
      ) : null}
      {candidates.map((candidate, i) => {
        const { title, when } = describe(candidate);
        return (
          <ListRow
            key={candidate.id}
            title={title}
            subtitle={when}
            variant="navigation"
            onPress={() => leftovers.onLink(entry, candidate)}
            divider={i < candidates.length - 1}
            testID={`entry-leftover-option-${i}`}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
