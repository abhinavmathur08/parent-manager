import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import type { PlanDate } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { i18n } from '@/i18n';

import type { ListView } from '../view';
import { buildExportDocument } from './document';
import { exportHtml } from './html';
import { printHtml, runExport, sharePdf, type ExportTarget } from './targets';

export type ExportSheetProps = {
  visible: boolean;
  onClose: () => void;
  view: ListView;
  weekStart: PlanDate;
  locale: string;
  /** Shows a short confirmation or error on the list screen. */
  onMessage: (message: string) => void;
};

/**
 * S-23, the export sheet (FR-EXP-1, FR-EXP-2, FR-PAY-10): every role can export and it's
 * never behind Premium. Unchecked items by default, with an option to include checked ones.
 * Everything renders on the device from the local list, so it works offline.
 */
export function ExportSheet({
  visible,
  onClose,
  view,
  weekStart,
  locale,
  onMessage,
}: ExportSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [includeChecked, setIncludeChecked] = useState(false);
  const [busy, setBusy] = useState<ExportTarget | null>(null);

  const doc = useMemo(
    () => buildExportDocument({ view, weekStart, includeChecked, locale, t }),
    [view, weekStart, includeChecked, locale, t],
  );
  const empty = doc.itemCount === 0;

  const run = async (target: ExportTarget, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(target);
    const result = await runExport(target, doc, action);
    setBusy(null);
    // iOS rejects when the print dialog is closed without printing, which isn't an error.
    if (!result.ok && !(target === 'print' && Platform.OS === 'ios')) {
      onMessage(t('list.export.failed'));
    }
  };
  const html = () => exportHtml(doc, t, i18n.dir(locale));

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('list.export.title')}
      testID="export-sheet"
    >
      <View style={{ gap: theme.space[3] }}>
        <Switch
          label={t('list.export.includeChecked')}
          description={t('list.export.includeCheckedHint')}
          value={includeChecked}
          onValueChange={setIncludeChecked}
          disabled={view.cart.length === 0}
          testID="export-include-checked"
        />
        {empty ? (
          <Text color="textSecondary" testID="export-empty">
            {view.total === 0 ? t('list.export.emptyList') : t('list.export.allChecked')}
          </Text>
        ) : (
          <Text color="textSecondary" testID="export-count">
            {t('list.count', { count: doc.itemCount })}
          </Text>
        )}
        <Button
          variant="secondary"
          icon="print"
          label={t('list.export.print')}
          onPress={() => void run('print', () => printHtml(html()))}
          disabled={empty}
          loading={busy === 'print'}
          fullWidth
          testID="export-print"
        />
        <Button
          variant="secondary"
          icon="pdf"
          label={t('list.export.pdf')}
          onPress={() => void run('pdf', () => sharePdf(html(), doc.title))}
          disabled={empty}
          loading={busy === 'pdf'}
          fullWidth
          testID="export-pdf"
        />
      </View>
    </BottomSheet>
  );
}
