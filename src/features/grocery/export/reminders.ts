import * as Calendar from 'expo-calendar';
import * as Linking from 'expo-linking';
import Storage from 'expo-sqlite/kv-store';

import { theme } from '@/constants/theme';
import { track } from '@/lib/analytics';

import type { ExportDocument } from './document';
import { planReminders } from './reminders-plan';

/**
 * Apple Reminders export (FR-EXP-3, FR-EXP-5), iOS only, through `expo-calendar`. One
 * Reminders list per household week, reused on re-export; see architecture section 7,
 * "Apple Reminders format". Everything happens on the device, so it works offline.
 */

/** The member refused (or earlier refused) the reminders permission. */
export class RemindersDenied extends Error {
  code = 'reminders_denied';
}

/** On-device only: which Reminders list this household's week went to. */
function listKey(householdId: string, weekStart: string) {
  return `export.reminders.${householdId}.${weekStart}`;
}

/** Asks for the reminders permission the first time it's used (FR-EXP-3). */
async function ensurePermission(): Promise<void> {
  const current = await Calendar.getRemindersPermissions();
  if (current.granted) return;
  if (!current.canAskAgain) throw new RemindersDenied();
  const answer = await Calendar.requestRemindersPermissions();
  track('reminders_permission_result', { granted: answer.granted });
  if (!answer.granted) throw new RemindersDenied();
}

/** The week's list from an earlier export, or a new one if there's none or it was deleted. */
async function weekList(
  householdId: string,
  doc: ExportDocument,
  title: string,
): Promise<Calendar.ExpoCalendar> {
  const key = listKey(householdId, doc.weekStart);
  const savedId = await Storage.getItem(key);
  if (savedId) {
    try {
      return await Calendar.ExpoCalendar.get(savedId);
    } catch {
      // Deleted in the Reminders app: make a new one below.
    }
  }
  const list = await Calendar.createCalendar({
    title,
    color: theme.light.color.primary,
    entityType: Calendar.EntityTypes.REMINDER,
  });
  await Storage.setItem(key, list.id);
  return list;
}

/** A link back to the List tab that carries only the item's random ID. */
export function reminderUrl(itemId: string): string {
  return Linking.createURL('list', { queryParams: { item: itemId } });
}

export async function exportToReminders(
  householdId: string,
  doc: ExportDocument,
  title: string,
): Promise<void> {
  await ensurePermission();
  const list = await weekList(householdId, doc, title);
  // A reminder that was never saved has no ID; there's nothing to match or change on it.
  const reminders = (await list.listReminders()).filter(
    (r): r is typeof r & { id: string } => typeof r.id === 'string',
  );
  const plan = planReminders(
    doc,
    reminders.map((r) => ({
      id: r.id,
      url: r.url ?? null,
      title: r.title ?? null,
      notes: r.notes ?? null,
      completed: Boolean(r.completed),
    })),
    reminderUrl,
  );
  const byId = new Map(reminders.map((r) => [r.id, r]));

  // One at a time, so Reminders shows them in the export's order.
  for (const reminder of plan.create) {
    await list.createReminder({ title: reminder.title, notes: reminder.notes, url: reminder.url });
  }
  for (const change of plan.update) {
    await byId.get(change.id)?.update({ title: change.title, notes: change.notes });
  }
  for (const id of plan.complete) {
    await byId.get(id)?.update({ completed: true, completionDate: new Date() });
  }
}
