import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Text } from '@/components/text';

/**
 * "Finish shopping" confirmation (FR-LIST-10): says how many checked items move to the
 * week's history and how many unchecked items stay on the list.
 */
export function FinishShoppingSheet({
  visible,
  checkedCount,
  uncheckedCount,
  busy,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  checkedCount: number;
  uncheckedCount: number;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('list.finish.title')}
      testID="list-finish-sheet"
      footer={
        <Button
          label={t('list.finish.confirm')}
          onPress={onConfirm}
          loading={busy}
          disabled={busy}
          fullWidth
          testID="list-finish-confirm"
        />
      }
    >
      <Text testID="list-finish-body">{t('list.finish.moved', { count: checkedCount })}</Text>
      <Text color="textSecondary" testID="list-finish-staying">
        {uncheckedCount
          ? t('list.finish.staying', { count: uncheckedCount })
          : t('list.finish.nothingLeft')}
      </Text>
    </BottomSheet>
  );
}
