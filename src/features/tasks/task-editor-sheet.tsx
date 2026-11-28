import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Stepper } from '@/components/stepper';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { wallInstant } from '@/features/calendar/editor';
import type { Member } from '@/features/household/members';
import { addDays, daysBetween } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber, formatTime } from '@/i18n/format';

import { canSaveTask, remindersFor, withDue, type TaskDraft } from './editor';
import { dayLabel } from './labels';
import { TASK_LIMITS } from './tables';

export type TaskEditorSheetProps = {
  visible: boolean;
  draft: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  onSave: () => void;
  onClose: () => void;
  locale: string;
  timeZone: string;
  today: string;
  userId: string | null;
  isParent: boolean;
  /** "Share with helpers" and assigning a helper are Premium (FR3-TASK-2, T5). */
  isPremium: boolean;
  members: readonly Member[];
  saving?: boolean;
};

const EPOCH = '1970-01-01';
const DUES = ['none', 'date', 'time'] as const;
/** When the fixed reminders fire, in minutes after midnight household time (FR3-NOT-1, PROPOSED). */
const REMINDER_MINUTES: Partial<Record<string, number>> = {
  'reminder.morning': 9 * 60,
  'reminder.day_before': 18 * 60,
};

/**
 * S-45 task editor (FR3-TASK-2), without repeats (T-03.2): only a title is required, and the
 * title is focused when the sheet opens, so a task takes one tap to open, typing and one tap on
 * Save. The title and notes are the only free text, with a hint to keep health details out
 * (FR3-PRIV-3). Its draft lives with the caller (`useDraftState`).
 */
export function TaskEditorSheet({
  visible,
  draft,
  onChange,
  onSave,
  onClose,
  locale,
  timeZone,
  today,
  userId,
  isParent,
  isPremium,
  members,
  saving = false,
}: TaskEditorSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const set = (patch: Partial<TaskDraft>) => onChange({ ...draft, ...patch });
  const gap = { gap: theme.space[2] };
  // Parents assign anyone (helpers on Premium); helpers only themselves or a parent (D-25).
  const assignable = members.filter(
    (m) => m.userId !== userId && (m.role === 'parent' || (isParent && isPremium)),
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('tasks.editor.title')}
      variant="form"
      testID="task-editor"
      footer={
        <Button
          label={t('tasks.editor.save')}
          onPress={onSave}
          disabled={!canSaveTask(draft)}
          loading={saving}
          fullWidth
          testID="task-save"
        />
      }
    >
      <View style={{ gap: theme.space[4] }}>
        <View style={gap}>
          <TextField
            label={t('tasks.editor.titleLabel')}
            placeholder={t('tasks.editor.titleHint')}
            value={draft.title}
            onChangeText={(title) => set({ title })}
            maxLength={TASK_LIMITS.titleLength}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => (canSaveTask(draft) ? onSave() : undefined)}
            testID="task-title"
          />
          <Text variant="caption" color="textSecondary" testID="task-privacy-hint">
            {t('tasks.editor.privacyHint')}
          </Text>
        </View>

        <Group label={t('tasks.editor.due')}>
          <View style={[styles.wrap, gap]}>
            {DUES.map((due) => (
              <Chip
                key={due}
                label={t(`tasks.editor.dues.${due}`)}
                selected={draft.due === due}
                onPress={() => onChange(withDue(draft, due))}
                testID={`task-due-${due}`}
              />
            ))}
          </View>
          {draft.due !== 'none' ? (
            <Stepper
              accessibilityLabel={t('tasks.editor.date')}
              value={daysBetween(EPOCH, draft.date)}
              onChange={(n) => set({ date: addDays(EPOCH, n) })}
              formatValue={(n) => dayLabel(addDays(EPOCH, n), today, locale)}
              testID="task-date"
            />
          ) : null}
          {draft.due === 'time' ? (
            <>
              <Stepper
                accessibilityLabel={t('tasks.editor.hour')}
                value={Math.floor(draft.minutes / 60)}
                min={0}
                max={23}
                onChange={(h) => set({ minutes: h * 60 + (draft.minutes % 60) })}
                formatValue={(h) =>
                  formatTime(
                    wallInstant(draft.date, h * 60 + (draft.minutes % 60), timeZone),
                    locale,
                    timeZone,
                  )
                }
                testID="task-hour"
              />
              <Stepper
                accessibilityLabel={t('tasks.editor.minute')}
                value={draft.minutes % 60}
                min={0}
                max={45}
                step={15}
                onChange={(m) => set({ minutes: Math.floor(draft.minutes / 60) * 60 + m })}
                formatValue={(m) => formatNumber(m, locale, { minimumIntegerDigits: 2 })}
                testID="task-minute"
              />
            </>
          ) : null}
        </Group>

        <Group label={t('tasks.editor.assignee')}>
          <View style={[styles.wrap, gap]}>
            <Chip
              label={t('tasks.editor.anyone')}
              selected={draft.assigneeUserId === null}
              onPress={() => set({ assigneeUserId: null })}
              testID="task-assignee-anyone"
            />
            {userId ? (
              <Chip
                label={t('tasks.editor.me')}
                selected={draft.assigneeUserId === userId}
                onPress={() => set({ assigneeUserId: userId })}
                testID="task-assignee-me"
              />
            ) : null}
            {assignable.map((member, i) => (
              <Chip
                key={member.userId}
                label={member.displayName ?? t('tasks.assignee.member')}
                selected={draft.assigneeUserId === member.userId}
                onPress={() => set({ assigneeUserId: member.userId })}
                testID={`task-assignee-${i}`}
              />
            ))}
          </View>
        </Group>

        {draft.due !== 'none' ? (
          <Group label={t('tasks.editor.reminder')}>
            <View style={[styles.wrap, gap]}>
              <Chip
                label={t('tasks.editor.reminders.none')}
                selected={draft.reminder === null}
                onPress={() => set({ reminder: null })}
                testID="task-reminder-none"
              />
              {remindersFor(draft.due).map((reminder) => (
                <Chip
                  key={reminder}
                  label={t(`tasks.editor.reminders.${reminder.slice('reminder.'.length)}`, {
                    time: formatTime(
                      wallInstant(draft.date, REMINDER_MINUTES[reminder] ?? 0, timeZone),
                      locale,
                      timeZone,
                    ),
                  })}
                  selected={draft.reminder === reminder}
                  onPress={() => set({ reminder })}
                  testID={`task-${reminder.replace('.', '-')}`}
                />
              ))}
            </View>
          </Group>
        ) : null}

        <TextField
          label={t('tasks.editor.notes')}
          value={draft.notes}
          onChangeText={(notes) => set({ notes })}
          maxLength={TASK_LIMITS.notesLength}
          multiline
          testID="task-notes"
        />

        {isParent ? (
          isPremium ? (
            <Switch
              label={t('tasks.editor.shared')}
              description={t('tasks.editor.sharedHint')}
              value={draft.shared}
              onValueChange={(shared) => set({ shared })}
              testID="task-shared"
            />
          ) : null
        ) : (
          <Text color="textSecondary" testID="task-shared-always">
            {t('tasks.editor.sharedAlways')}
          </Text>
        )}
      </View>
    </BottomSheet>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" accessibilityRole="header">
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
