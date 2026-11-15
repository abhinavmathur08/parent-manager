import type { TFunction } from 'i18next';

import type { ExportDocument } from './document';

/**
 * Plain checklist text for the share sheet and the clipboard (FR-EXP-4): the title and week,
 * then each section heading followed by one line per item with a checkbox symbol. No markup,
 * so it pastes cleanly into Google Keep, Messages and email. Every word and symbol comes
 * from the locale file, and the lines come from the shared export document (FR-EXP-6).
 */
export function exportText(doc: ExportDocument, t: TFunction): string {
  const blocks = [t('list.export.textTitle', { title: doc.title, week: doc.week })];
  for (const section of doc.sections) {
    const lines = section.items.map((item) =>
      t('list.export.textItem', {
        box: item.checked ? t('list.export.boxChecked') : t('list.export.box'),
        line: item.line,
      }),
    );
    blocks.push([section.heading, ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}
