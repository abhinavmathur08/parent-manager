import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { AllergenNotice } from '@/components/allergen-notice';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Tag } from '@/components/tag';
import { Text } from '@/components/text';
import { nameKey, type AllergenCode } from '@/features/ingredients/catalog-ids';
import { loadParserVocabulary } from '@/features/ingredients/matching';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import type { DraftLine, RecipeDraft } from '@/features/recipes/draft';
import { RecipeEditor } from '@/features/recipes/recipe-editor';
import { allergenMatches } from '@/features/recipes/scale';
import type { RecipeSourceType } from '@/features/recipes/tables';
import { useHouseholdAllergies } from '@/features/recipes/use-household-allergies';
import { clearDraft, useDraftState } from '@/hooks/use-draft-state';
import { useTheme } from '@/hooks/use-theme';
import { formatList, type AppLocale, type Region, type UnitSystem } from '@/i18n';
import { track } from '@/lib/analytics';

import { fetchJob, type ImportInput, type ImportResult } from './api';
import { discardImage } from './image';
import { setManualPrefill } from './manual';
import { needsReview, normalizeDraft, type LineReview } from './normalize';
import { cachedResult, PENDING_IMPORT_KEY, type PendingImport } from './use-import-run';

type Household = { id: string; locale: AppLocale; region: Region; unitSystem: UnitSystem };

/** What review keeps beside the form, so highlights and analytics survive the app being killed. */
type ReviewMeta = {
  recipeId: string;
  lines: Record<string, LineReview>;
  sourceAllergens: AllergenCode[];
  /** Each line as imported, to count the lines the member edited (AI-24). */
  initial: Record<string, string>;
  openedAt: number;
};

const signature = (l: DraftLine) =>
  JSON.stringify([l.ingredientId, l.quantity, l.unitId, l.note, l.optional]);

/** The saved recipe's source type (FR-AI-15) and the analytics input type. */
export function sourceTypeOf(input: ImportInput | undefined): RecipeSourceType {
  if (input?.type === 'link') return 'url';
  if (input?.type === 'image') return input.kind;
  return 'text';
}

const formKey = (job: string) => `import:review:${job}`;
const metaKey = (job: string) => `import:review-meta:${job}`;

/**
 * S-21, the import review (FR-AI-4 to FR-AI-7, FR-AI-13, FR-AI-15). The draft opens in the
 * recipe editor; nothing is saved until the member presses save. Low-confidence and unmatched
 * lines are highlighted, each line shows the source's original text, and an allergen that
 * matches a household person, or that the source mentions, is flagged at the top with the
 * disclaimer. Normalization to ingredient and unit IDs happens here, on the device.
 */
export function ReviewScreen({ job, household }: { job: string; household: Household }) {
  const { t } = useTranslation();
  const [pending, , clearPending] = useDraftState<PendingImport | null>(PENDING_IMPORT_KEY, null);
  const [meta, setMeta] = useDraftState<ReviewMeta | null>(metaKey(job), null);
  const [result, setResult] = useState<ImportResult | null>(() => cachedResult(job) ?? null);
  const [missing, setMissing] = useState(false);
  const ingredients = useIngredients(household.locale);
  const vocabulary = useMemo(() => loadParserVocabulary(household.locale), [household.locale]);
  const [initialDraft, setInitialDraft] = useState<RecipeDraft>();
  const input = pending?.jobId === job ? pending.input : undefined;
  const sourceType = sourceTypeOf(input);
  const inputType =
    sourceType === 'url' || sourceType === 'photo' || sourceType === 'screenshot'
      ? sourceType
      : 'text';

  // A review reopened after the app was killed has its form saved; otherwise read the job.
  useEffect(() => {
    if (meta || result) return;
    let active = true;
    fetchJob(job).then(
      (state) => {
        if (!active) return;
        if (state.status === 'succeeded') setResult(state.result);
        else setMissing(true);
      },
      () => active && setMissing(true),
    );
    return () => {
      active = false;
    };
  }, [job, meta, result]);

  // Normalize once, when the draft first arrives (AI-3, AI-4).
  const reported = useRef(false);
  useEffect(() => {
    if (meta || !result || reported.current) return;
    reported.current = true;
    const review = normalizeDraft(result.draft, {
      index: ingredients.index,
      vocabulary,
      region: household.region,
      newId: randomUUID,
      sourceUrl: input?.type === 'link' ? input.url : undefined,
    });
    const lines = Object.values(review.lines);
    setInitialDraft(review.recipe);
    setMeta({
      recipeId: randomUUID(),
      lines: review.lines,
      sourceAllergens: review.sourceAllergens,
      initial: Object.fromEntries(review.recipe.lines.map((l) => [l.id, signature(l)])),
      openedAt: Date.now(),
    });
    track('ai_import_completed', {
      input_type: inputType,
      parser: result.source === 'structured_data' ? 'schema_org' : 'llm',
      duration_ms: pending ? Math.max(0, Date.now() - pending.startedAt) : 0,
      ingredient_count: lines.length,
      low_confidence_count: lines.filter((l) => !l.unmatched && needsReview(l)).length,
      unmatched_count: lines.filter((l) => l.unmatched).length,
      allergen_flag_count: review.recipe.lines.filter(
        (l) => ingredients.allergens(l.ingredientId).length,
      ).length,
    });
  }, [meta, result, ingredients, vocabulary, household.region, input, inputType, pending, setMeta]);

  function finish() {
    discardImage(input);
    clearDraft(formKey(job));
    clearDraft(metaKey(job));
    clearPending();
  }

  function discard() {
    Alert.alert(t('importRecipe.review.discardTitle'), t('importRecipe.review.discardBody'), [
      { text: t('importRecipe.review.keep'), style: 'cancel' },
      {
        text: t('importRecipe.review.discard'),
        style: 'destructive',
        onPress: () => {
          track('ai_import_discarded', {
            input_type: inputType,
            seconds_in_review: meta ? Math.round((Date.now() - meta.openedAt) / 1000) : 0,
          });
          finish();
          router.replace('/plan/recipes');
        },
      },
    ]);
  }

  function enterManually(draft: RecipeDraft) {
    const raw = [
      ...draft.lines.map((l) => l.rawText ?? '').filter(Boolean),
      '',
      ...draft.steps.map((s) => s.text),
    ].join('\n');
    setManualPrefill({
      title: draft.title,
      notes: raw.trim().slice(0, 5000),
      sourceUrl: draft.sourceUrl,
    });
    finish();
    router.replace({ pathname: '/plan/recipes/edit', params: { from: 'import' } });
  }

  if (!meta) {
    return <ReviewLoading missing={missing} />;
  }
  return (
    <ReviewForm
      job={job}
      meta={meta}
      household={household}
      initialDraft={initialDraft}
      sourceType={sourceType}
      onSaved={(recipeId, draft) => {
        const edited = draft.lines.filter((l) => meta.initial[l.id] !== signature(l)).length;
        const removed = Object.keys(meta.initial).filter(
          (id) => !draft.lines.some((l) => l.id === id),
        ).length;
        track('ai_import_saved', {
          input_type: inputType,
          lines_edited_count: edited + removed,
          seconds_in_review: Math.round((Date.now() - meta.openedAt) / 1000),
        });
        finish();
        router.replace({ pathname: '/plan/recipes/[id]', params: { id: recipeId } });
      }}
      onDiscard={discard}
      onEnterManually={enterManually}
    />
  );
}

function ReviewLoading({ missing }: { missing: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View
      testID="import-review-loading"
      style={[
        styles.center,
        { backgroundColor: theme.color.background, gap: theme.space[4], padding: theme.space[6] },
      ]}
    >
      {missing ? (
        <>
          <Text accessibilityRole="alert">{t('importRecipe.review.gone')}</Text>
          <Button
            label={t('importRecipe.startOver')}
            onPress={() => router.replace('/plan/recipes/import')}
            testID="import-review-start-over"
          />
        </>
      ) : (
        <ActivityIndicator
          color={theme.color.primary}
          accessibilityLabel={t('importRecipe.progress.reading')}
        />
      )}
    </View>
  );
}

function ReviewForm({
  job,
  meta,
  household,
  initialDraft,
  sourceType,
  onSaved,
  onDiscard,
  onEnterManually,
}: {
  job: string;
  meta: ReviewMeta;
  household: Household;
  initialDraft: RecipeDraft | undefined;
  sourceType: RecipeSourceType;
  onSaved: (recipeId: string, draft: RecipeDraft) => void;
  onDiscard: () => void;
  onEnterManually: (draft: RecipeDraft) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const ingredients = useIngredients(household.locale);
  const allergies = useHouseholdAllergies(household.id);
  const { locale } = household;

  // Which household people each line's allergens affect (FR-AI-7, AI-11).
  const allergic = useMemo(() => {
    const byCode = new Map<AllergenCode, string[]>();
    for (const person of allergies.people) {
      for (const code of person.allergies) {
        byCode.set(code, [...(byCode.get(code) ?? []), person.displayName]);
      }
    }
    return byCode;
  }, [allergies.people]);

  const shown = useRef(false);

  const header = (draft: RecipeDraft) => {
    const matches = allergenMatches(
      draft.lines.map((l) => l.ingredientId),
      (id) => ingredients.allergens(id),
      allergies.people,
    );
    // The source's own mentions add to the catalog's flags, never replace them (AI-11).
    const matched = new Set(matches.map((m) => m.allergen));
    for (const code of meta.sourceAllergens) {
      const people = allergic.get(code);
      if (people && !matched.has(code)) matches.push({ allergen: code, people });
    }
    const mentioned = meta.sourceAllergens.filter((code) => !allergic.has(code));
    if (!shown.current && (matches.length || mentioned.length)) {
      shown.current = true;
      track('allergen_notice_shown', {
        surface: 'import_review',
        allergen_count: matches.length + mentioned.length,
      });
    }
    return (
      <View style={{ gap: theme.space[3] }}>
        <Text color="textSecondary" testID="import-review-intro">
          {t('importRecipe.review.intro')}
        </Text>
        {matches.map((match) => (
          <AllergenNotice
            key={match.allergen}
            variant="importReview"
            allergen={t(nameKey(match.allergen))}
            person={formatList(match.people, locale)}
            testID={`import-allergen-${match.allergen.slice(9)}`}
          />
        ))}
        {mentioned.length ? (
          <SourceAllergenNotice
            allergens={formatList(
              mentioned.map((code) => t(nameKey(code))),
              locale,
            )}
          />
        ) : null}
        {allergies.status === 'unavailable' ? (
          <Text variant="caption" color="textSecondary" testID="import-allergen-unavailable">
            {t('recipes.detail.allergiesUnavailable')}
          </Text>
        ) : null}
      </View>
    );
  };

  const lineExtra = (line: DraftLine, i: number) => {
    const review = meta.lines[line.id];
    const changed = review && meta.initial[line.id] !== signature(line);
    const marks: { label: string; key: string }[] = [];
    if (review && !changed && review.unmatched) {
      marks.push({ label: t('importRecipe.review.unmatched'), key: 'unmatched' });
    } else if (review && !changed && needsReview(review)) {
      marks.push({ label: t('importRecipe.review.lowConfidence'), key: 'low' });
    }
    if (review && !changed && needsReview(review)) {
      // An unmatched or uncertain line can't be checked, so no warning isn't "safe" (AI-13).
      marks.push({ label: t('importRecipe.review.notChecked'), key: 'unchecked' });
    }
    for (const code of ingredients.allergens(line.ingredientId)) {
      const people = allergic.get(code);
      if (people) {
        marks.push({
          label: t('importRecipe.review.lineAllergen', {
            allergen: t(nameKey(code)),
            person: formatList(people, locale),
          }),
          key: `allergen-${code.slice(9)}`,
        });
      }
    }
    if (!review && !marks.length) return null;
    return (
      <View
        style={{
          gap: theme.space[1],
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[2],
        }}
      >
        {review?.original ? (
          <Text variant="caption" color="textSecondary" testID={`import-line-original-${i}`}>
            {t('importRecipe.review.original', { text: review.original })}
          </Text>
        ) : null}
        {marks.length ? (
          <View style={[styles.wrap, { gap: theme.space[1] }]}>
            {marks.map((mark) => (
              <Tag
                key={mark.key}
                variant="warning"
                label={mark.label}
                testID={`import-line-${i}-${mark.key}`}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const footer = (draft: RecipeDraft) => (
    <View style={{ gap: theme.space[3] }}>
      <Button
        variant="secondary"
        label={t('importRecipe.enterManually')}
        onPress={() => onEnterManually(draft)}
        fullWidth
        testID="import-review-manual"
      />
      <Button
        variant="ghost"
        label={t('importRecipe.review.discard')}
        onPress={onDiscard}
        fullWidth
        testID="import-review-discard"
      />
    </View>
  );

  return (
    <RecipeEditor
      saved={null}
      recipeId={meta.recipeId}
      draftKey={formKey(job)}
      household={household}
      initialDraft={initialDraft}
      onSaved={onSaved}
      review={{
        title: t('importRecipe.review.title'),
        sourceType,
        header,
        lineExtra,
        footer,
      }}
    />
  );
}

/** The source itself says it may contain an allergen nobody in the household has (FR-AI-7). */
function SourceAllergenNotice({ allergens }: { allergens: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View
      testID="import-source-allergens"
      accessible
      accessibilityRole="alert"
      style={{
        borderWidth: 1.5,
        borderColor: theme.color.warning,
        borderRadius: theme.radius.card,
        backgroundColor: theme.color.surface,
        padding: theme.space[4],
        gap: theme.space[1],
      }}
    >
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Icon name="warning" size="md" color="warning" />
        <Text variant="bodyStrong" color="warning" style={styles.grow}>
          {t('importRecipe.review.sourceMentions', { allergens })}
        </Text>
      </View>
      <Text variant="caption" color="textSecondary">
        {t('components.allergenNotice.disclaimer')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  grow: { flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
