import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { track } from '@/lib/analytics';

/**
 * The export targets' side effects (FR-EXP-2). Each renders the shared export document, and
 * analytics get only the target, the item count and whether checked items were included;
 * never names, quantities or section contents (CLAUDE.md privacy rules).
 */

export type ExportTarget = 'print' | 'pdf' | 'apple_reminders' | 'share_text' | 'copy_text';

export type ExportResult = { ok: true } | { ok: false; code: string };

/** Thrown when the member closes the share sheet without sharing, so it isn't counted. */
export class ExportDismissed extends Error {
  code = 'dismissed';
}

/** A fixed, lower-case error code for analytics; never an error message. */
export function errorCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const clean = code.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return /^[a-z][a-z0-9_]*$/.test(clean) ? clean : 'unknown';
}

export async function runExport(
  target: ExportTarget,
  doc: { itemCount: number; includedChecked: boolean },
  action: () => Promise<void>,
): Promise<ExportResult> {
  try {
    await action();
    track('list_exported', {
      target,
      item_count: doc.itemCount,
      included_checked: doc.includedChecked,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ExportDismissed) return { ok: false, code: error.code };
    const code = errorCode(error);
    track('list_export_failed', { target, error_code: code });
    return { ok: false, code };
  }
}

/** The system print dialog: AirPrint on iOS, the print service on Android. */
export function printHtml(html: string): Promise<void> {
  return Print.printAsync({ html });
}

/** Renders a PDF on the device (offline) and opens the share sheet to save or send it. */
export async function sharePdf(html: string, dialogTitle: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
}

/** The system share sheet with plain text (FR-EXP-4), for Keep, Messages, email and others. */
export async function shareText(message: string, title: string): Promise<void> {
  const result = await Share.share({ message, title }, { dialogTitle: title, subject: title });
  if (result.action === Share.dismissedAction) throw new ExportDismissed();
}

/** Copies the text (FR-EXP-4). It's a grocery list, not a secret, so it isn't marked sensitive. */
export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}
