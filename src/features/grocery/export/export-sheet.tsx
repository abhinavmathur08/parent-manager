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
import { copyText, printHtml, runExport, shareText, sharePdf, type ExportTarget } from './targets';
import { exportText } from './text';

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
  const [copied, setCopied] = useState(false);

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
    if (result.ok) {
      if (target === 'copy_text') setCopied(true);
      return;
    }
    // Closing the share sheet, or on iOS the print dialog, without finishing isn't an error.
    if (result.code === 'dismissed' || (target === 'print' && Platform.OS === 'ios')) return;
    onMessage(t('list.export.failed'));
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
          onValueChange={(value) => {
            setIncludeChecked(value);
            setCopied(false);
          }}
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
        <Button
          variant="secondary"
          icon="share"
          label={t('list.export.share')}
          onPress={() => void run('share_text', () => shareText(exportText(doc, t), doc.title))}
          disabled={empty}
          loading={busy === 'share_text'}
          fullWidth
          testID="export-share"
        />
        <Button
          variant="secondary"
          icon="copy"
          label={t('list.export.copy')}
          onPress={() => void run('copy_text', () => copyText(exportText(doc, t)))}
          disabled={empty}
          loading={busy === 'copy_text'}
          fullWidth
          testID="export-copy"
        />
        {copied ? (
          <Text color="success" accessibilityLiveRegion="polite" testID="export-copied">
            {t('list.export.copied')}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
