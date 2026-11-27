import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useCalendarMembers } from '@/features/calendar/use-members';
import { todayIn } from '@/features/planner/week';
import { useEntitlement } from '@/features/subscription/entitlement';
import { useDraftState } from '@/hooks/use-draft-state';
import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { assigneeRole, newTaskDraft, taskValues, type TaskDraft } from './editor';
import { TASKS } from './tables';
import { TaskEditorSheet } from './task-editor-sheet';

/** The new task's draft key: what's typed, and whether the sheet is open, survive a restart. */
export const TASK_DRAFT_KEY = 'tasks:task:new';

type Stored = { open: boolean; draft: TaskDraft | null };

export type TaskEditorOptions = {
  householdId: string;
  locale: string;
  timeZone: string;
  userId: string | null;
  isParent: boolean;
};

/**
 * The task editor sheet (S-45) and its draft, kept on the device so the sheet comes back as it
 * was after the app is killed (NFR-A11Y-8). Saving writes through the sync layer, so it works
 * offline and reaches the partner within 2 seconds online (FR3-TASK-6).
 */
export function useTaskEditor({
  householdId,
  locale,
  timeZone,
  userId,
  isParent,
}: TaskEditorOptions) {
  const { t } = useTranslation();
  const writer = useSyncWriter();
  const { isPremium } = useEntitlement();
  const members = useCalendarMembers(householdId);
  const [stored, setStored, clear] = useDraftState<Stored>(TASK_DRAFT_KEY, {
    open: false,
    draft: null,
  });
  const [saving, setSaving] = useState(false);

  /** Opens a new task, or the unsaved one left from before. */
  const open = () =>
    setStored((s) => ({
      open: true,
      draft: s.draft ?? newTaskDraft(new Date(), timeZone, userId, isParent),
    }));

  const save = async () => {
    const draft = stored.draft;
    if (!draft || saving) return;
    setSaving(true);
    try {
      const values = taskValues(draft, timeZone, userId);
      await writer.insert(TASKS.name, randomUUID(), values);
      // Fixed values and booleans only: never the title, notes or names (NFR3-SEC-2).
      track('task_created', {
        source: 'manual',
        has_due: draft.due !== 'none',
        has_time: draft.due === 'time',
        assignee_role: assigneeRole(
          draft.assigneeUserId,
          userId,
          (id) => members.find((m) => m.userId === id)?.role,
        ),
        shared: draft.shared,
        repeats: false,
        reminder: values.reminder !== null,
      });
      clear();
    } catch {
      Alert.alert(t('tasks.editor.failed'));
    } finally {
      setSaving(false);
    }
  };

  const sheet = stored.draft ? (
    <TaskEditorSheet
      visible={stored.open}
      draft={stored.draft}
      onChange={(draft) => setStored({ open: true, draft })}
      onSave={() => void save()}
      onClose={clear}
      locale={locale}
      timeZone={timeZone}
      today={todayIn(timeZone)}
      userId={userId}
      isParent={isParent}
      isPremium={isPremium}
      members={members}
      saving={saving}
    />
  ) : null;

  return { open, sheet };
}
