import type { ExportDocument } from './document';

/**
 * What an Apple Reminders export changes (FR-EXP-3, architecture section 7, "Apple Reminders
 * format"). Pure, so re-export rules are tested without a device. Reminders are matched to
 * grocery items by the item ID in the reminder's URL, never by their text.
 */

export type ExistingReminder = {
  id: string;
  url: string | null;
  title: string | null;
  notes: string | null;
  completed: boolean;
};

export type NewReminder = { itemId: string; title: string; notes: string; url: string };

export type RemindersPlan = {
  /** In the export's order: sections in aisle order, then names. */
  create: NewReminder[];
  update: { id: string; title: string; notes: string }[];
  complete: string[];
};

/** The grocery item ID in a reminder URL such as `parentmanager://list?item=<id>`. */
export function itemIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = /[?&]item=([0-9A-Za-z-]+)/.exec(url);
  return match?.[1] ?? null;
}

export function planReminders(
  doc: ExportDocument,
  existing: readonly ExistingReminder[],
  urlFor: (itemId: string) => string,
): RemindersPlan {
  const byItem = new Map<string, ExistingReminder>();
  const complete: string[] = [];
  for (const reminder of existing) {
    const itemId = itemIdFromUrl(reminder.url);
    if (!itemId) continue; // Added by hand in Reminders: left alone.
    if (byItem.has(itemId)) {
      // A duplicate from an interrupted export: close it, so the list shows one.
      if (!reminder.completed) complete.push(reminder.id);
      continue;
    }
    byItem.set(itemId, reminder);
  }

  const create: NewReminder[] = [];
  const update: RemindersPlan['update'] = [];
  const exported = new Set<string>();
  for (const section of doc.sections) {
    for (const item of section.items) {
      exported.add(item.id);
      const reminder = byItem.get(item.id);
      if (!reminder) {
        if (!item.checked) {
          create.push({
            itemId: item.id,
            title: item.line,
            notes: section.heading,
            url: urlFor(item.id),
          });
        }
        continue;
      }
      // Something the shopper completed in Reminders stays completed.
      if (reminder.completed) continue;
      if (item.checked) complete.push(reminder.id);
      else if (reminder.title !== item.line || reminder.notes !== section.heading) {
        update.push({ id: reminder.id, title: item.line, notes: section.heading });
      }
    }
  }

  // Items checked off (and not included) or removed since the last export.
  for (const [itemId, reminder] of byItem) {
    if (!exported.has(itemId) && !reminder.completed) complete.push(reminder.id);
  }
  return { create, update, complete };
}
