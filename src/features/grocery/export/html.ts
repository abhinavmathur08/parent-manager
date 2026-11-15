import type { TFunction } from 'i18next';

import { theme } from '@/constants/theme';

import type { ExportDocument } from './document';

/**
 * The print and PDF template (FR-EXP-2): a single-column checklist grouped by store section,
 * a drawn checkbox per item, and the week in the heading. Text only, no images, so it prints
 * offline and screen readers and translators see real text. Colors and sizes come from the
 * light theme's tokens, because paper is light.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Item names and custom names are member text, so everything is escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const { color } = theme.light;
const { type, space, radius } = theme;

const STYLE = `
@page { margin: ${space[10]}px ${space[8]}px; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: ${color.text};
  background: ${color.surface};
  font-family: -apple-system, system-ui, Roboto, "Segoe UI", sans-serif;
  font-size: ${type.body.fontSize}px;
  line-height: ${type.body.lineHeight}px;
}
h1 { margin: 0; font-family: Georgia, serif; font-size: ${type.screenTitle.fontSize}px; line-height: ${type.screenTitle.lineHeight}px; }
.week { margin: ${space[1]}px 0 ${space[6]}px; color: ${color.textSecondary}; }
h2 {
  margin: ${space[6]}px 0 ${space[2]}px;
  padding-bottom: ${space[1]}px;
  border-bottom: 1px solid ${color.border};
  font-family: Georgia, serif;
  font-size: ${type.sectionLabel.fontSize}px;
  line-height: ${type.sectionLabel.lineHeight}px;
  break-after: avoid;
}
ul { list-style: none; margin: 0; padding: 0; }
li {
  display: flex;
  align-items: flex-start;
  gap: ${space[3]}px;
  padding: ${space[1]}px 0;
  break-inside: avoid;
  overflow-wrap: anywhere;
}
.box {
  flex: none;
  width: ${space[4]}px;
  height: ${space[4]}px;
  margin-top: ${space[1]}px;
  border: 1.5px solid ${color.text};
  border-radius: ${radius.sm / 2}px;
  font-size: ${type.caption.fontSize}px;
  line-height: ${space[4] - 3}px;
  text-align: center;
}
.done .text { color: ${color.textSecondary}; text-decoration: line-through; }
`;

export function exportHtml(doc: ExportDocument, t: TFunction, dir: 'ltr' | 'rtl' = 'ltr') {
  const sections = doc.sections
    .map((section) => {
      const items = section.items
        .map((item) => {
          const state = item.checked ? t('list.export.checked') : t('list.export.unchecked');
          return (
            `<li${item.checked ? ' class="done"' : ''}>` +
            `<span class="box" role="img" aria-label="${escapeHtml(state)}">${item.checked ? '✓' : ''}</span>` +
            `<span class="text">${escapeHtml(item.line)}</span></li>`
          );
        })
        .join('');
      return `<section><h2>${escapeHtml(section.heading)}</h2><ul>${items}</ul></section>`;
    })
    .join('');

  return (
    `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(doc.title)}</title><style>${STYLE}</style></head><body>` +
    `<h1>${escapeHtml(doc.title)}</h1><p class="week">${escapeHtml(doc.week)}</p>` +
    sections +
    `</body></html>`
  );
}
