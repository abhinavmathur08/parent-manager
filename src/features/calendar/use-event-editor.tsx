import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { usePlanPeople } from '@/features/planner/use-plan-people';
import { useEntitlement } from '@/features/subscription/entitlement';
import { usePremiumSheet } from '@/features/subscription/premium-sheet';
import { useDraftState } from '@/hooks/use-draft-state';
import type { AppLocale } from '@/i18n';

import { newDraft, REMINDERS_PER_EVENT, type EventDraft } from './editor';
import { EventEditorSheet } from './event-editor-sheet';
import { useCalendarMembers } from './use-members';
import { useCreateEvent } from './writes';

type Stored = { open: boolean; draft: EventDraft | null };

export const EDITOR_DRAFT_KEY = 'calendar:event:new';

export type EventEditorOptions = {
  householdId: string;
  locale: AppLocale;
  timeZone: string;
  userId: string | null;
  isParent: boolean;
};

/**
 * The add-event sheet and its draft. Whether it's open and what's typed are kept on the
 * device, so the sheet comes back as it was after the app is killed (NFR-A11Y-8).
 */
export function useEventEditor({
  householdId,
  locale,
  timeZone,
  userId,
  isParent,
}: EventEditorOptions) {
  const { t } = useTranslation();
  const [stored, setStored, clear] = useDraftState<Stored>(EDITOR_DRAFT_KEY, {
    open: false,
    draft: null,
  });
  const [saving, setSaving] = useState(false);
  const { isPremium } = useEntitlement();
  const { openPremiumSheet } = usePremiumSheet();
  const people = usePlanPeople(householdId).people;
  const members = useCalendarMembers(householdId);
  const create = useCreateEvent(timeZone, userId);

  const open = () =>
    setStored((s) => ({ open: true, draft: s.draft ?? newDraft(new Date(), timeZone, isParent) }));

  const save = async () => {
    if (!stored.draft || saving) return;
    setSaving(true);
    try {
      await create(stored.draft);
      clear();
    } catch {
      Alert.alert(t('calendar.editor.failed'));
    } finally {
      setSaving(false);
    }
  };

  const sheet = stored.draft ? (
    <EventEditorSheet
      visible={stored.open}
      title={t('calendar.editor.title')}
      draft={stored.draft}
      onChange={(draft) => setStored({ open: true, draft })}
      onSave={() => void save()}
      onClose={clear}
      onPremiumRequired={() => {
        // The draft is kept, so "Add an event" opens it again after the Premium sheet.
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

  return { open, sheet };
}
