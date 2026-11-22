import Storage from 'expo-sqlite/kv-store';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { IconButton } from '@/components/icon-button';
import { useBusyDaysContext } from '@/features/calendar/busy-days';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useRecipeRows } from '@/features/recipes/data';
import { allergenMatches } from '@/features/recipes/scale';
import { starterText } from '@/features/recipes/starter/library';
import { useEntitlement } from '@/features/subscription/entitlement';
import { usePremiumSheet } from '@/features/subscription/premium-sheet';
import { useTheme } from '@/hooks/use-theme';
import type { AppLocale } from '@/i18n';
import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { easyCandidates, easyOffer, type EasyCandidate, type EasyOffer } from './easy-dinner';
import { EasyDinnerSheet, type ShownCandidate } from './easy-dinner-sheet';
import { nextPosition, type PlanPerson } from './plan';
import type { PlanEntryPortionRow, PlanEntryRow } from './tables';
import type { Undoable } from './use-undoable';
import { addDays, type PlanDate, type WeekStart } from './week';
import { copyEntry, useAddEntry, useEntryActions } from './writes';

/** A free household sees "easy dinner ideas" on one day a week at most (FR2-BUSY-5, PROPOSED). */
const PROMPT_DAYS = 7;

const dismissedKey = (household: string) => `busy.easy.dismissed.${household}`;
const promptKey = (household: string) => `busy.easy.prompt.${household}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const stored = Storage.getItemSync(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    Storage.setItemSync(key, JSON.stringify(value));
  } catch {
    // Not kept: the suggestion may show again.
  }
}

type Prompt = { date: PlanDate; on: PlanDate };

export type EasyDinnerInput = {
  householdId: string;
  locale: AppLocale;
  weekStart: WeekStart;
  today: PlanDate;
  days: readonly PlanDate[];
  canWrite: boolean;
  /** This week's shown entries, and every entry the device has (for leftovers). */
  entries: readonly PlanEntryRow[];
  allEntries: readonly PlanEntryRow[];
  portions: readonly PlanEntryPortionRow[];
  people: readonly PlanPerson[];
  ingredientIdsOf: (recipeId: string) => readonly string[];
  servings: number;
  hold: (change: Undoable) => void;
  noteChange: () => void;
  onError: () => void;
};

/**
 * Easy dinners on busy days (B-01.3, FR2-BUSY-2 to FR2-BUSY-6). Premium households get
 * "add an easy dinner" or "swap for an easy meal" and a sheet of up to 5; free households get
 * one "easy dinner ideas" action a week that opens the Premium sheet (`busy_day_meals`).
 * Nothing changes without a tap, and dismissing hides the day's suggestion on this device.
 */
export function useEasyDinner(input: EasyDinnerInput) {
  const { householdId, locale, today, days, canWrite } = input;
  const { t } = useTranslation();
  const busy = useBusyDaysContext();
  const { isPremium } = useEntitlement();
  const { openPremiumSheet } = usePremiumSheet();
  const { recipes } = useRecipeRows();
  const ingredients = useIngredients(locale);
  const addEntry = useAddEntry(locale);
  const entryActions = useEntryActions();
  const writer = useSyncWriter();
  const [dismissed, setDismissed] = useState<PlanDate[]>(() =>
    readJson<PlanDate[]>(dismissedKey(householdId), []),
  );
  const [prompt, setPrompt] = useState<Prompt | null>(() =>
    readJson<Prompt | null>(promptKey(householdId), null),
  );
  const [open, setOpen] = useState<{
    date: PlanDate;
    offer: EasyOffer;
    shown: ShownCandidate[];
  } | null>(null);

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const offers = useMemo(() => {
    const map = new Map<PlanDate, EasyOffer>();
    if (!busy || !canWrite) return map;
    for (const date of days) {
      if (date < today || dismissed.includes(date)) continue;
      const offer = easyOffer(busy.dayFor(date), date, input.entries, (id) => recipeById.get(id));
      if (offer) map.set(date, offer);
    }
    return map;
  }, [busy, canWrite, days, today, dismissed, input.entries, recipeById]);

  // Free: the day already prompted this week, or the first day with an offer once a week has passed.
  const promptFresh = prompt !== null && today < addDays(prompt.on, PROMPT_DAYS);
  const freeDate = isPremium
    ? null
    : promptFresh
      ? offers.has(prompt.date)
        ? prompt.date
        : null
      : ([...offers.keys()][0] ?? null);
  useEffect(() => {
    if (!freeDate || promptFresh) return;
    // Kept for later launches; this session keeps showing it on the same first day.
    writeJson(promptKey(householdId), { date: freeDate, on: today });
  }, [freeDate, promptFresh, today, householdId]);

  const dismiss = (date: PlanDate) => {
    const next = [...dismissed.filter((d) => d >= addDays(today, -14)), date];
    writeJson(dismissedKey(householdId), next);
    setDismissed(next);
    if (!isPremium) {
      // Dismissing the free prompt uses up this week's.
      const used = { date, on: today };
      writeJson(promptKey(householdId), used);
      setPrompt(used);
    }
  };

  const candidatesFor = (date: PlanDate, offer: EasyOffer): ShownCandidate[] =>
    easyCandidates({
      date,
      entries: input.allEntries,
      recipes,
      weekStart: input.weekStart,
      replacing: offer.mode === 'swap' ? offer.entry : null,
    }).map((candidate) => {
      const ids =
        candidate.source === 'starter'
          ? candidate.starter.lines.map((line) => line.ingredientId)
          : input.ingredientIdsOf(
              candidate.source === 'leftovers' ? candidate.recipeId : candidate.recipe.id,
            );
      return {
        candidate,
        title:
          candidate.source === 'starter'
            ? starterText(candidate.starter, locale).title
            : candidate.source === 'leftovers'
              ? t('busy.easy.leftoversOf', {
                  title: recipeById.get(candidate.recipeId)?.title ?? '',
                })
              : candidate.recipe.title,
        allergens: allergenMatches(ids, (id) => ingredients.allergens(id), input.people),
      };
    });

  const openSheet = (date: PlanDate, offer: EasyOffer) => {
    const shown = candidatesFor(date, offer);
    setOpen({ date, offer, shown });
    track('busy_day_suggestion_shown', { mode: offer.mode, candidates_count: shown.length });
  };

  const apply = async (candidate: EasyCandidate) => {
    if (!open) return;
    const { date, offer, shown } = open;
    const title = shown.find((s) => s.candidate.key === candidate.key)?.title ?? '';
    setOpen(null);
    input.noteChange();
    try {
      const position = nextPosition(input.allEntries, date, 'dinner');
      const id =
        candidate.source === 'leftovers'
          ? await copyEntry(writer, candidate.entry, input.portions, {
              date,
              slot: 'dinner',
              position,
              leftoverOf: candidate.entry.id,
            })
          : await addEntry({
              date,
              slot: 'dinner',
              position,
              servings: input.servings,
              choice:
                candidate.source === 'household'
                  ? { kind: 'recipe', recipeId: candidate.recipe.id }
                  : { kind: 'starter', key: candidate.starter.key },
              via: 'recent',
            });
      track('busy_day_suggestion_applied', { mode: offer.mode, source: candidate.source });
      const replaced = offer.mode === 'swap' ? [offer.entry.id] : [];
      // The swapped-out dinner goes when the undo bar does; undo removes the new one.
      input.hold({
        message: t(offer.mode === 'swap' ? 'busy.easy.swapped' : 'busy.easy.added', { title }),
        hidden: replaced,
        commit: () => entryActions.remove(replaced, { track: false }),
        undo: () => entryActions.remove([id], { track: false }),
      });
    } catch {
      input.onError();
    }
  };

  const actionFor = (date: PlanDate): ReactNode => {
    const offer = offers.get(date);
    if (!offer || (!isPremium && freeDate !== date)) return null;
    return (
      <EasyDinnerAction
        date={date}
        label={t(
          !isPremium
            ? 'busy.easy.ideas'
            : offer.mode === 'swap'
              ? 'busy.easy.swap'
              : 'busy.easy.add',
        )}
        testID={isPremium ? `easy-dinner-open-${date}` : `easy-dinner-ideas-${date}`}
        onPress={() => (isPremium ? openSheet(date, offer) : openPremiumSheet('busy_day_meals'))}
        onDismiss={() => dismiss(date)}
      />
    );
  };

  const sheet = (
    <EasyDinnerSheet
      mode={open?.offer.mode ?? null}
      candidates={open?.shown ?? []}
      locale={locale}
      onApply={(candidate) => void apply(candidate)}
      onClose={() => setOpen(null)}
    />
  );
  return { actionFor, sheet };
}

function EasyDinnerAction({
  date,
  label,
  testID,
  onPress,
  onDismiss,
}: {
  date: PlanDate;
  label: string;
  testID: string;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.space[2] }]}>
      <Button
        variant="secondary"
        label={label}
        onPress={onPress}
        testID={testID}
        style={styles.grow}
      />
      <IconButton
        icon="close"
        accessibilityLabel={t('busy.easy.dismiss')}
        onPress={onDismiss}
        testID={`easy-dinner-dismiss-${date}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  grow: {
    flexGrow: 1,
    flexShrink: 1,
  },
});
