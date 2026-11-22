import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { usePlanPeople } from '@/features/planner/use-plan-people';
import { useEntitlement } from '@/features/subscription/entitlement';
import { usePremiumSheet } from '@/features/subscription/premium-sheet';
import { useDraftState } from '@/hooks/use-draft-state';
import type { AppLocale } from '@/i18n';

import {
  draftFromEvent,
  draftFromOccurrence,
  newDraft,
  REMINDERS_PER_EVENT,
  type EventDraft,
} from './editor';
import { EventEditorSheet } from './event-editor-sheet';
import type { Occurrence } from './repeat';
import type { EventExceptionRow, EventRow } from './tables';
import { useCalendarMembers } from './use-members';
import { useCreateEvent, useOccurrenceWrites, useUpdateEvent, type EventChildren } from './writes';

/**
 * `eventId` is set when editing, and `originalDate` too when only that occurrence changes
 * ("this event", FR2-CAL-4). Both are null for a new event.
 */
type Stored = {
  open: boolean;
  eventId: string | null;
  originalDate?: string | null;
  draft: EventDraft | null;
};

export type EditTarget = EventChildren & { exceptions: readonly EventExceptionRow[] };

/** A new event's draft, and an edit's, are kept apart so each screen restores its own. */
export const EDITOR_DRAFT_KEYS = {
  add: 'calendar:event:new',
  edit: 'calendar:event:edit',
} as const;

export type EventEditorOptions = {
  mode: keyof typeof EDITOR_DRAFT_KEYS;
  householdId: string;
  locale: AppLocale;
  timeZone: string;
  userId: string | null;
  isParent: boolean;
};

/**
 * The event editor sheet (S-37) and its draft. Whether it's open and what's typed are kept on
 * the device, so the sheet comes back as it was after the app is killed (NFR-A11Y-8).
 */
export function useEventEditor({
  mode,
  householdId,
  locale,
  timeZone,
  userId,
  isParent,
}: EventEditorOptions) {
  const { t } = useTranslation();
  const [stored, setStored, clear] = useDraftState<Stored>(EDITOR_DRAFT_KEYS[mode], {
    open: false,
    eventId: null,
    draft: null,
  });
  const [saving, setSaving] = useState(false);
  const { isPremium } = useEntitlement();
  const { openPremiumSheet } = usePremiumSheet();
  const people = usePlanPeople(householdId).people;
  const members = useCalendarMembers(householdId);
  const create = useCreateEvent(timeZone, userId);
  const update = useUpdateEvent(timeZone, userId);
  const occurrences = useOccurrenceWrites(timeZone);
  const [editing, setEditing] = useState<{ event: EventRow; children: EditTarget } | null>(null);

  /** Opens a new event, or the unsaved one left from before. */
  const open = () =>
    setStored((s) => ({
      open: true,
      eventId: null,
      draft: s.draft ?? newDraft(new Date(), timeZone, isParent),
    }));

  /**
   * Opens an event to edit: the whole series, or one occurrence when `occurrence` is given.
   * An unsaved edit of the same target comes back as it was.
   */
  const edit = (event: EventRow, children: EditTarget, occurrence: Occurrence | null = null) => {
    setEditing({ event, children });
    const personIds = children.people
      .filter((p) => p.event_id === event.id)
      .map((p) => p.person_id);
    const reminders = children.reminders
      .filter((r) => r.event_id === event.id)
      .map((r) => r.offset_minutes);
    const originalDate = occurrence?.originalDate ?? null;
    setStored((s) => ({
      open: true,
      eventId: event.id,
      originalDate,
      draft:
        s.eventId === event.id && (s.originalDate ?? null) === originalDate && s.draft
          ? s.draft
          : occurrence
            ? draftFromOccurrence(event, occurrence, personIds, reminders, timeZone)
            : draftFromEvent(event, personIds, reminders, timeZone),
    }));
  };

  const save = async () => {
    if (!stored.draft || saving) return;
    setSaving(true);
    try {
      if (stored.eventId) {
        if (!editing || editing.event.id !== stored.eventId) return;
        if (stored.originalDate) {
          await occurrences.move(
            editing.event,
            stored.originalDate,
            stored.draft,
            editing.children.exceptions,
          );
        } else {
          await update(editing.event, stored.draft, editing.children);
        }
      } else {
        await create(stored.draft);
      }
      clear();
    } catch {
      Alert.alert(t('calendar.editor.failed'));
    } finally {
      setSaving(false);
    }
  };

  // An edit restored after a restart waits for its screen to pass the event again.
  const visible = stored.open && (!stored.eventId || editing?.event.id === stored.eventId);

  const sheet = stored.draft ? (
    <EventEditorSheet
      visible={visible}
      title={t(
        stored.originalDate
          ? 'calendar.editor.editOneTitle'
          : stored.eventId
            ? 'calendar.editor.editTitle'
            : 'calendar.editor.title',
      )}
      occurrenceOnly={Boolean(stored.originalDate)}
      draft={stored.draft}
      onChange={(draft) => setStored((s) => ({ ...s, open: true, draft }))}
      onSave={() => void save()}
      onClose={clear}
      onPremiumRequired={() => {
        // The draft is kept, so the sheet opens again as it was after the Premium sheet.
        setStored((s) => ({ ...s, open: false }));
        openPremiumSheet('reminders', { afterSheet: true });
      }}
      locale={locale}
      timeZone={timeZone}
      userId={userId}
      isParent={isParent}
      reminderLimit={isPremium ? REMINDERS_PER_EVENT.premium : REMINDERS_PER_EVENT.free}
      people={people}
      members={members}
      saving={saving}
    />
  ) : null;

  return { open, edit, pendingEditId: stored.open ? stored.eventId : null, sheet };
}
