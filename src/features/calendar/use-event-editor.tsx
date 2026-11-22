import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { usePlanPeople } from '@/features/planner/use-plan-people';
import { useEntitlement } from '@/features/subscription/entitlement';
import { usePremiumSheet } from '@/features/subscription/premium-sheet';
import { useDraftState } from '@/hooks/use-draft-state';
import type { AppLocale } from '@/i18n';

import { draftFromEvent, newDraft, REMINDERS_PER_EVENT, type EventDraft } from './editor';
import { EventEditorSheet } from './event-editor-sheet';
import type { EventRow } from './tables';
import { useCalendarMembers } from './use-members';
import { useCreateEvent, useUpdateEvent, type EventChildren } from './writes';

/** `eventId` is set when editing; null for a new event. */
type Stored = { open: boolean; eventId: string | null; draft: EventDraft | null };

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
  const [editing, setEditing] = useState<{ event: EventRow; children: EventChildren } | null>(null);

  /** Opens a new event, or the unsaved one left from before. */
  const open = () =>
    setStored((s) => ({
      open: true,
      eventId: null,
      draft: s.draft ?? newDraft(new Date(), timeZone, isParent),
    }));

  /** Opens an event to edit; an unsaved edit of the same event comes back as it was. */
  const edit = (event: EventRow, children: EventChildren) => {
    setEditing({ event, children });
    setStored((s) => ({
      open: true,
      eventId: event.id,
      draft:
        s.eventId === event.id && s.draft
          ? s.draft
          : draftFromEvent(
              event,
              children.people.filter((p) => p.event_id === event.id).map((p) => p.person_id),
              children.reminders
                .filter((r) => r.event_id === event.id)
                .map((r) => r.offset_minutes),
              timeZone,
            ),
    }));
  };

  const save = async () => {
    if (!stored.draft || saving) return;
    setSaving(true);
    try {
      if (stored.eventId) {
        if (!editing || editing.event.id !== stored.eventId) return;
        await update(editing.event, stored.draft, editing.children);
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
      title={t(stored.eventId ? 'calendar.editor.editTitle' : 'calendar.editor.title')}
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
