import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AppState,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type ScrollView,
} from 'react-native';

import { AllergenNotice } from '@/components/allergen-notice';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { PRESSED_OPACITY } from '@/components/focus-ring';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { Tag } from '@/components/tag';
import { EmptyState } from '@/components/empty-state';
import { Text } from '@/components/text';
import { Toast } from '@/components/toast';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatList, formatNumber, type AppLocale } from '@/i18n';

import { usePlanWeek } from './data';
import { AddSheet, type AddTarget } from './add-sheet';
import { EntryActionsSheet, type EntryTarget } from './entry-actions-sheet';
import { EntrySheet, type EntryChange } from './entry-sheet';
import {
  defaultServings,
  entryAllergens,
  hasBabyPlate,
  nextPosition,
  portionsFor,
  slotEntries,
  weekEntries,
} from './plan';
import { SLOTS, type PlanEntryRow, type Slot } from './tables';
import { usePlanPeople } from './use-plan-people';
import { useUndoable } from './use-undoable';
import { useAddEntry, useEntryActions, useSetPortions, useSetServings } from './writes';
import {
  addDays,
  startOfWeek,
  todayIn,
  toDate,
  weekDates,
  type PlanDate,
  type WeekStart,
} from './week';

export type PlanHousehold = {
  id: string;
  locale: AppLocale;
  weekStart: WeekStart;
  timezone: string | null;
};

export type PlanWeekActions = {
  /** Opens the add sheet for a slot (S-11). */
  onAdd?: (date: PlanDate, slot: Slot) => void;
  /** Opens an entry (S-12). */
  onOpenEntry?: (entry: PlanEntryRow) => void;
  /** Long-press actions on an entry (FR-PLAN-7). */
  onEntryActions?: (entry: PlanEntryRow) => void;
  /** "Copy last week" (FR-PLAN-9); offered when last week has entries. */
  onCopyLastWeek?: (start: PlanDate) => void;
  /** "Apply a template" (FR-PLAN-10, Premium). */
  onApplyTemplate?: (start: PlanDate) => void;
};

/** Today in the household's timezone, checked again when the app comes back. */
function useToday(timezone: string | null): PlanDate {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);
  return useMemo(() => todayIn(timezone, new Date(now)), [timezone, now]);
}

/** Swiping sideways changes the week (FR-PLAN-2); vertical drags still scroll. */
function useWeekSwipe(onSwipe: (direction: -1 | 1) => void) {
  return useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) > 64) onSwipe(g.dx < 0 ? 1 : -1);
        },
      }),
    [onSwipe],
  );
}

/** Servings for a new entry until the household's people are known. */
const DEFAULT_SERVINGS = 2;

const dayFormat = { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
const rangeFormat = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;

/**
 * S-10, the Plan tab (FR-PLAN-1, FR-PLAN-2, FR-PLAN-11, FR-ONB-5): one week from the
 * household's week start, 7 days of 5 slots, with previous, next, today and swiping. Empty
 * slots stay compact. Entries show allergen markers for people who eat them. Everything
 * reads the local copy, so it works offline.
 */
export function PlanWeekScreen({
  household,
  canWrite,
  actions: overrides = {},
}: {
  household: PlanHousehold;
  canWrite: boolean;
  /** Replaces the screen's own handlers, for tests and later items. */
  actions?: PlanWeekActions;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = household;
  const today = useToday(household.timezone);
  const currentStart = startOfWeek(today, household.weekStart);
  const [shown, setShown] = useState<PlanDate | null>(null);
  // A changed week start regroups the display only (spec 3.6); entries keep their dates.
  const start = startOfWeek(shown ?? currentStart, household.weekStart);
  const days = useMemo(() => weekDates(start), [start]);
  const week = usePlanWeek(start);
  const people = usePlanPeople(household.id);
  const ingredients = useIngredients(locale);
  const addEntry = useAddEntry(locale);
  const [adding, setAdding] = useState<AddTarget | null>(null);
  const [acting, setActing] = useState<PlanEntryRow | null>(null);
  const [opened, setOpened] = useState<PlanEntryRow | null>(null);
  const setPortions = useSetPortions();
  const setServings = useSetServings();
  const entryActions = useEntryActions();
  const failed = useCallback(() => Alert.alert(t('plan.actions.failed')), [t]);
  const undoable = useUndoable(failed);
  const actions: PlanWeekActions = {
    onAdd: canWrite ? (date, slot) => setAdding({ date, slot }) : undefined,
    onOpenEntry: setOpened,
    onEntryActions: canWrite ? setActing : undefined,
    ...overrides,
  };
  // Entries waiting on an undo bar are hidden until it goes (FR-PLAN-7).
  const shownEntries = useMemo(() => {
    const hidden = new Set(undoable.hidden);
    return week.entries.filter((e) => !hidden.has(e.id));
  }, [week.entries, undoable.hidden]);
  const titleOf = (entry: PlanEntryRow) =>
    (entry.recipe_id ? week.titles.get(entry.recipe_id) : undefined) ??
    entry.free_text ??
    t('plan.deletedRecipe');

  const runAction = async (task: () => Promise<unknown>) => {
    setActing(null);
    try {
      await task();
    } catch {
      failed();
    }
  };
  const moveEntry = (entry: PlanEntryRow, target: EntryTarget) =>
    runAction(() =>
      entryActions.move(entry, {
        ...target,
        position: nextPosition(week.all, target.date, target.slot),
      }),
    );
  const duplicateEntry = (entry: PlanEntryRow, target: EntryTarget) =>
    runAction(() =>
      entryActions.duplicate(entry, week.portions, {
        ...target,
        position: nextPosition(week.all, target.date, target.slot),
      }),
    );
  const saveEntry = (entry: PlanEntryRow, change: EntryChange) => {
    setOpened(null);
    void runAction(() =>
      change.kind === 'portions'
        ? setPortions(entry, change.portions, week.portions)
        : setServings(entry, change.servings),
    );
  };
  const removeEntry = (entry: PlanEntryRow) => {
    setActing(null);
    undoable.hold({
      message: t('plan.actions.removed', { title: titleOf(entry) }),
      hidden: [entry.id],
      commit: () => entryActions.remove([entry.id]),
    });
  };

  const goTo = useCallback(
    (next: PlanDate) => setShown(next === currentStart ? null : next),
    [currentStart],
  );
  const swipe = useWeekSwipe(
    useCallback((direction: -1 | 1) => goTo(addDays(start, direction * 7)), [goTo, start]),
  );

  const lastWeekHasEntries = useMemo(
    () => weekEntries(week.all, addDays(start, -7)).length > 0,
    [week.all, start],
  );

  // Today is scrolled into view (FR-PLAN-1).
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const layout = useRef<{ days: number | null; today: number | null }>({ days: null, today: null });
  const scrolled = useRef<PlanDate | null>(null);
  const scrollToToday = () => {
    const { days: daysY, today: todayY } = layout.current;
    if (daysY === null || todayY === null || scrolled.current === start) return;
    scrolled.current = start;
    scrollRef.current?.scrollTo({ y: Math.max(0, daysY + todayY - theme.space[4]) });
  };

  const isCurrent = start === currentStart;
  const range = t('plan.range', {
    start: formatDate(toDate(start), locale, rangeFormat),
    end: formatDate(toDate(addDays(start, 6)), locale, rangeFormat),
  });
  const firstAddDate = isCurrent ? today : start;

  return (
    <View style={styles.grow}>
      <Screen title={t('plan.title')} scrollRef={scrollRef} testID="plan-screen">
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <IconButton
            icon="back"
            accessibilityLabel={t('plan.previousWeek')}
            onPress={() => goTo(addDays(start, -7))}
            testID="plan-previous"
          />
          <Text
            variant="sectionLabel"
            style={styles.grow}
            accessibilityRole="header"
            testID="plan-range"
          >
            {range}
          </Text>
          <IconButton
            icon="forward"
            accessibilityLabel={t('plan.nextWeek')}
            onPress={() => goTo(addDays(start, 7))}
            testID="plan-next"
          />
        </View>
        {!isCurrent ? (
          <Button
            variant="ghost"
            label={t('plan.today')}
            onPress={() => goTo(currentStart)}
            testID="plan-today"
          />
        ) : null}

        {!week.loading && shownEntries.length === 0 ? (
          <Card testID="plan-empty">
            <EmptyState
              icon="plan"
              message={t(canWrite ? 'plan.empty' : 'plan.emptyReadOnly')}
              actionLabel={canWrite && actions.onAdd ? t('plan.addMeal') : undefined}
              onAction={() => actions.onAdd?.(firstAddDate, 'dinner')}
              testID="plan-empty-state"
            />
            {canWrite && lastWeekHasEntries && actions.onCopyLastWeek ? (
              <Button
                variant="secondary"
                label={t('plan.copyLastWeek')}
                onPress={() => actions.onCopyLastWeek?.(start)}
                testID="plan-copy-last-week"
              />
            ) : null}
            {canWrite && actions.onApplyTemplate ? (
              <Button
                variant="ghost"
                label={t('plan.applyTemplate')}
                onPress={() => actions.onApplyTemplate?.(start)}
                testID="plan-apply-template"
              />
            ) : null}
          </Card>
        ) : null}

        <View
          {...swipe.panHandlers}
          onLayout={(e) => {
            layout.current.days = e.nativeEvent.layout.y;
            scrollToToday();
          }}
          style={{ gap: theme.space[3] }}
          testID="plan-days"
        >
          {days.map((date, index) => {
            const isToday = date === today;
            return (
              <View
                key={date}
                onLayout={
                  isToday
                    ? (e) => {
                        layout.current.today = e.nativeEvent.layout.y;
                        scrollToToday();
                      }
                    : undefined
                }
              >
                <Card
                  variant={isToday ? 'highlight' : 'default'}
                  testID={`plan-day-${date}`}
                  style={{ gap: theme.space[3] }}
                >
                  <View style={[styles.row, { gap: theme.space[2] }]}>
                    <Text variant="cardTitle" accessibilityRole="header" style={styles.grow}>
                      {formatDate(toDate(date), locale, dayFormat)}
                    </Text>
                    {isToday ? <Tag label={t('plan.today')} testID="plan-today-tag" /> : null}
                  </View>
                  <DaySlots
                    date={date}
                    index={index}
                    entries={shownEntries}
                    canWrite={canWrite}
                    actions={actions}
                    titleOf={titleOf}
                    babyPlateOf={(entry) =>
                      hasBabyPlate(portionsFor(entry.id, people.people, week.portions).values())
                    }
                    allergensOf={(entry) =>
                      entryAllergens(
                        entry,
                        week.ingredientIdsOf,
                        (id) => ingredients.allergens(id),
                        people.people,
                        week.portions,
                      )
                    }
                    locale={locale}
                  />
                </Card>
              </View>
            );
          })}
        </View>
        {people.status === 'unavailable' ? (
          <Text variant="caption" color="textSecondary" testID="plan-allergies-unavailable">
            {t('plan.allergiesUnavailable')}
          </Text>
        ) : null}
        <AddSheet
          target={adding}
          locale={locale}
          entries={week.all}
          defaultServings={defaultServings(people.people) ?? DEFAULT_SERVINGS}
          onAdd={async (choice, servings, via) => {
            if (!adding) return;
            await addEntry({
              ...adding,
              position: nextPosition(week.all, adding.date, adding.slot),
              servings,
              choice,
              via,
            });
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
        <EntrySheet
          entry={opened}
          title={opened ? titleOf(opened) : ''}
          people={people.people}
          peopleStatus={people.status}
          portionRows={week.portions}
          locale={locale}
          canWrite={canWrite}
          onSave={saveEntry}
          onClose={() => setOpened(null)}
        />
        <EntryActionsSheet
          entry={acting}
          title={acting ? titleOf(acting) : ''}
          days={days}
          locale={locale}
          onMove={(entry, target) => void moveEntry(entry, target)}
          onDuplicate={(entry, target) => void duplicateEntry(entry, target)}
          onRemove={removeEntry}
          onClose={() => setActing(null)}
        />
      </Screen>
      <Toast
        visible={undoable.current !== null}
        message={undoable.current?.message ?? ''}
        variant="undo"
        actionLabel={t('plan.actions.undo')}
        onAction={undoable.undo}
        onDismiss={undoable.settle}
        testID="plan-undo"
      />
    </View>
  );
}

function DaySlots({
  date,
  index,
  entries,
  canWrite,
  actions,
  titleOf,
  babyPlateOf,
  allergensOf,
  locale,
}: {
  date: PlanDate;
  /** The day's place in the week, 0 to 6, for stable test IDs. */
  index: number;
  entries: readonly PlanEntryRow[];
  canWrite: boolean;
  actions: PlanWeekActions;
  titleOf: (entry: PlanEntryRow) => string;
  babyPlateOf: (entry: PlanEntryRow) => boolean;
  allergensOf: (entry: PlanEntryRow) => ReturnType<typeof entryAllergens>;
  locale: AppLocale;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const filled = SLOTS.map((slot) => ({ slot, list: slotEntries(entries, date, slot) }));
  const empty = filled.filter((s) => s.list.length === 0).map((s) => s.slot);
  const addable = canWrite && actions.onAdd;

  return (
    <View style={{ gap: theme.space[3] }}>
      {filled
        .filter((s) => s.list.length > 0)
        .map(({ slot, list }) => (
          <View key={slot} style={{ gap: theme.space[1] }} testID={`plan-slot-${index}-${slot}`}>
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <Text variant="overline" color="textSecondary" style={styles.grow}>
                {t(`plan.slots.${slot}`)}
              </Text>
              {addable ? (
                <IconButton
                  icon="add"
                  accessibilityLabel={t('plan.addTo', {
                    slot: t(`plan.slots.${slot}`),
                    day: formatDate(toDate(date), locale, dayFormat),
                  })}
                  onPress={() => actions.onAdd?.(date, slot)}
                  testID={`plan-add-${index}-${slot}`}
                />
              ) : null}
            </View>
            {list.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                title={titleOf(entry)}
                babyPlate={babyPlateOf(entry)}
                matches={allergensOf(entry)}
                locale={locale}
                onPress={actions.onOpenEntry}
                onLongPress={canWrite ? actions.onEntryActions : undefined}
              />
            ))}
          </View>
        ))}
      {addable && empty.length ? (
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          {empty.map((slot) => (
            <Chip
              key={slot}
              variant="action"
              label={t(`plan.slots.${slot}`)}
              onPress={() => actions.onAdd?.(date, slot)}
              testID={`plan-add-${index}-${slot}`}
            />
          ))}
        </View>
      ) : null}
      {!addable && empty.length === SLOTS.length ? (
        <Text color="textSecondary">{t('plan.nothingPlanned')}</Text>
      ) : null}
    </View>
  );
}

function EntryRow({
  entry,
  title,
  babyPlate,
  matches,
  locale,
  onPress,
  onLongPress,
}: {
  entry: PlanEntryRow;
  title: string;
  /** Someone eats it from a baby plate, which the entry says (FR-PLAN-6). */
  babyPlate: boolean;
  matches: ReturnType<typeof entryAllergens>;
  locale: AppLocale;
  onPress?: (entry: PlanEntryRow) => void;
  onLongPress?: (entry: PlanEntryRow) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const servings = t('plan.servings', {
    count: entry.servings,
    value: formatNumber(entry.servings, locale),
  });
  return (
    <Pressable
      testID={`plan-entry-${entry.id}`}
      onPress={onPress ? () => onPress(entry) : undefined}
      onLongPress={onLongPress ? () => onLongPress(entry) : undefined}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={t('plan.entryLabel', { title, servings })}
      accessibilityHint={onLongPress ? t('plan.entryActionsHint') : undefined}
      style={({ pressed }) => [
        {
          minHeight: theme.layout.minTarget,
          justifyContent: 'center',
          gap: theme.space[1],
          opacity: pressed ? PRESSED_OPACITY : 1,
        },
      ]}
    >
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Text variant="bodyStrong" style={styles.grow}>
          {title}
        </Text>
        <Text variant="caption" color="textSecondary">
          {servings}
        </Text>
      </View>
      {babyPlate ? (
        <Tag label={t('plan.entry.babyPlate')} testID={`plan-entry-${entry.id}-baby-plate`} />
      ) : null}
      {matches.map((match) => (
        <AllergenNotice
          key={match.allergen}
          variant="inline"
          allergen={t(`allergens.${match.allergen.slice('allergen.'.length)}`)}
          person={formatList(match.people, locale)}
          testID={`plan-entry-${entry.id}-allergen-${match.allergen.slice('allergen.'.length)}`}
        />
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  grow: {
    flex: 1,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
