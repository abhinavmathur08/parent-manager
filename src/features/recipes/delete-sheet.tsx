import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { formatNumber, type AppLocale } from '@/i18n';

/**
 * Confirms deleting a recipe (FR-REC-11). When it's planned this week or later, the sheet
 * says how many entries use it and that they stay on the plan as text.
 */
export function DeleteRecipeSheet({
  visible,
  title,
  upcoming,
  locale,
  onDelete,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** Live plan entries using the recipe, from this week on. */
  upcoming: number;
  locale: AppLocale;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await onDelete();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('recipes.delete.title', { title })}
      testID="recipe-delete-sheet"
      footer={
        <Button
          variant="destructive"
          label={t('recipes.delete.confirm')}
          onPress={() => void confirm()}
          loading={busy}
          disabled={busy}
          fullWidth
          testID="recipe-delete-confirm"
        />
      }
    >
      <Text testID="recipe-delete-body">
        {upcoming > 0
          ? t('recipes.delete.planned', {
              count: upcoming,
              value: formatNumber(upcoming, locale),
            })
          : t('recipes.delete.unplanned')}
      </Text>
      {failed ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="recipe-delete-error">
          {t('recipes.delete.failed')}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
