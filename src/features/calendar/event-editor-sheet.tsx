import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Stepper } from '@/components/stepper';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { addDays, daysBetween, toDate } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatNumber, formatTime, type AppLocale } from '@/i18n';

import {
  canSave,
  LENGTH_STEP_MINUTES,
  MAX_ALL_DAY_DAYS,
  MAX_LENGTH_MINUTES,
  toggleReminder,
  wallInstant,
  withKind,
  type EventDraft,
} from './editor';
import { kindKey } from './agenda-screen';
import { RepeatPicker } from './repeat-picker';
import { EVENT_KINDS, EVENT_LIMITS, REMINDER_OFFSETS } from './tables';

export type EditorPerson = { id: string; displayName: string };
export type EditorMember = { userId: string; displayName: string | null };

export type EventEditorSheetProps = {
  visible: boolean;
  /** The sheet's title: a new event or an edit. */
  title: string;
  draft: EventDraft;
  onChange: (draft: EventDraft) => void;
  onSave: () => void;
  onClose: () => void;
  /** A Free household asked for more reminders than it has (FR2-PAY-1, trigger `reminders`). */
  onPremiumRequired: () => void;
  locale: AppLocale;
  timeZone: string;
  userId: string | null;
  isParent: boolean;
  reminderLimit: number;
  people: readonly EditorPerson[];
  members: readonly EditorMember[];
  saving?: boolean;
  /**
   * Changing one occurrence of a series ("this event", FR2-CAL-4): only its date, times and
   * taking member can differ from the series, so the other fields are hidden.
   */
  occurrenceOnly?: boolean;
};

const EPOCH = '1970-01-01';
const DATE_FORMAT = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' } as const;

/**
 * S-37 event editor (FR2-CAL-2): only a title is required, since the start defaults to the
 * next whole hour today. The title field is focused when the sheet opens, so an appointment
 * takes typing and one tap on Save. Its draft lives with the caller (`useDraftState`).
 */
export function EventEditorSheet({
  visible,
  title,
  draft,
  onChange,
  onSave,
  onClose,
  onPremiumRequired,
  locale,
  timeZone,
  userId,
  isParent,
  reminderLimit,
  people,
  members,
  saving = false,
  occurrenceOnly = false,
}: EventEditorSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [overLimit, setOverLimit] = useState(false);
  const set = (patch: Partial<EventDraft>) => onChange({ ...draft, ...patch });
  const time = (minutes: number) =>
    formatTime(wallInstant(draft.date, minutes, timeZone), locale, timeZone);
  const dateLabel = (date: string) => formatDate(toDate(date), locale, DATE_FORMAT);
  const others = members.filter((m) => m.userId !== userId);
  const gap = { gap: theme.space[2] };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      variant="form"
      testID="event-editor"
      footer={
        <Button
          label={t('calendar.editor.save')}
          onPress={onSave}
          disabled={!canSave(draft)}
          loading={saving}
          fullWidth
          testID="event-save"
        />
      }
    >
      <View style={{ gap: theme.space[4] }}>
        {occurrenceOnly ? (
          <Text color="textSecondary" testID="event-editor-one">
            {t('calendar.editor.oneOnly', { title: draft.title })}
          </Text>
        ) : (
          <>
            <TextField
              label={t('calendar.editor.titleLabel')}
              placeholder={t('calendar.editor.titleHint')}
              value={draft.title}
              onChangeText={(title) => set({ title })}
              maxLength={EVENT_LIMITS.titleLength}
              autoFocus
              returnKeyType="done"
              testID="event-title"
            />

            <Group label={t('calendar.editor.kind')}>
              <View style={[styles.wrap, gap]}>
                {EVENT_KINDS.map((kind) => (
                  <Chip
                    key={kind}
                    label={t(kindKey(kind))}
                    selected={draft.kind === kind}
                    onPress={() => onChange(withKind(draft, kind))}
                    testID={`event-kind-${kind}`}
                  />
                ))}
              </View>
            </Group>

            <Switch
              label={t('calendar.editor.allDay')}
              value={draft.allDay}
              onValueChange={(allDay) => set({ allDay })}
              testID="event-all-day"
            />
          </>
        )}
        <Group label={t('calendar.editor.date')}>
          <Stepper
            accessibilityLabel={t('calendar.editor.date')}
            value={daysBetween(EPOCH, draft.date)}
            onChange={(n) => set({ date: addDays(EPOCH, n) })}
            formatValue={(n) => dateLabel(addDays(EPOCH, n))}
            testID="event-date"
          />
        </Group>
        {draft.allDay ? (
          <Group label={t('calendar.editor.days')}>
            <Stepper
              accessibilityLabel={t('calendar.editor.days')}
              value={draft.days}
              min={1}
              max={MAX_ALL_DAY_DAYS}
              onChange={(days) => set({ days })}
              formatValue={(n) => dateLabel(addDays(draft.date, n - 1))}
              testID="event-days"
            />
          </Group>
        ) : (
          <>
            <Group label={t('calendar.editor.startHour')}>
              <Stepper
                accessibilityLabel={t('calendar.editor.startHour')}
                value={Math.floor(draft.startMinutes / 60)}
                min={0}
                max={23}
                onChange={(h) => set({ startMinutes: h * 60 + (draft.startMinutes % 60) })}
                formatValue={(h) => time(h * 60 + (draft.startMinutes % 60))}
                testID="event-start-hour"
              />
            </Group>
            <Group label={t('calendar.editor.startMinute')}>
              <Stepper
                accessibilityLabel={t('calendar.editor.startMinute')}
                value={draft.startMinutes % 60}
                min={0}
                max={45}
                step={15}
                onChange={(m) =>
                  set({ startMinutes: Math.floor(draft.startMinutes / 60) * 60 + m })
                }
                formatValue={(m) => formatNumber(m, locale, { minimumIntegerDigits: 2 })}
                testID="event-start-minute"
              />
            </Group>
            <Group label={t('calendar.editor.length')}>
              <Stepper
                accessibilityLabel={t('calendar.editor.length')}
                value={draft.lengthMinutes}
                min={LENGTH_STEP_MINUTES}
                max={MAX_LENGTH_MINUTES}
                step={LENGTH_STEP_MINUTES}
                onChange={(lengthMinutes) => set({ lengthMinutes })}
                formatValue={(n) =>
                  t('calendar.editor.endsAt', {
                    time: formatTime(
                      new Date(
                        wallInstant(draft.date, draft.startMinutes, timeZone).getTime() +
                          n * 60_000,
                      ),
                      locale,
                      timeZone,
                    ),
                  })
                }
                testID="event-length"
              />
            </Group>
          </>
        )}

        {!occurrenceOnly && people.length > 0 ? (
          <Group label={t('calendar.editor.for')}>
            <View style={[styles.wrap, gap]}>
              {people.map((person) => {
                const selected = draft.personIds.includes(person.id);
                return (
                  <Chip
                    key={person.id}
                    label={person.displayName}
                    selected={selected}
                    onPress={() =>
                      set({
                        personIds: selected
                          ? draft.personIds.filter((id) => id !== person.id)
                          : [...draft.personIds, person.id],
                      })
                    }
                    testID={`event-for-${person.id}`}
                  />
                );
              })}
            </View>
          </Group>
        ) : null}

        <Group label={t('calendar.editor.taking')}>
          <View style={[styles.wrap, gap]}>
            <Chip
              label={t('calendar.editor.nobody')}
              selected={draft.takingUserId === null}
              onPress={() => set({ takingUserId: null })}
              testID="event-taking-nobody"
            />
            {userId ? (
              <Chip
                label={t('calendar.editor.me')}
                selected={draft.takingUserId === userId}
                onPress={() => set({ takingUserId: userId })}
                testID="event-taking-me"
              />
            ) : null}
            {/* Only parents choose someone else (spec section 2, C6). */}
            {isParent
              ? others.map((member) => (
                  <Chip
                    key={member.userId}
                    label={member.displayName ?? t('calendar.editor.member')}
                    selected={draft.takingUserId === member.userId}
                    onPress={() => set({ takingUserId: member.userId })}
                    testID={`event-taking-${member.userId}`}
                  />
                ))
              : null}
          </View>
        </Group>

        {occurrenceOnly ? null : (
          <>
            <RepeatPicker
              repeat={draft.repeat}
              date={draft.date}
              locale={locale}
              onChange={(repeat) => set({ repeat })}
            />
            <TextField
              label={t('calendar.editor.place')}
              value={draft.place}
              onChangeText={(place) => set({ place })}
              maxLength={EVENT_LIMITS.placeLength}
              testID="event-place"
            />
            <TextField
              label={t('calendar.editor.notes')}
              placeholder={t('calendar.editor.notesHint')}
              value={draft.notes}
              onChangeText={(notes) => set({ notes })}
              maxLength={EVENT_LIMITS.notesLength}
              multiline
              testID="event-notes"
            />

            <Group label={t('calendar.editor.reminders')}>
              <View style={[styles.wrap, gap]}>
                {REMINDER_OFFSETS.map((offset) => (
                  <Chip
                    key={offset}
                    label={t(`calendar.reminders.${offset}`)}
                    selected={draft.reminders.includes(offset)}
                    onPress={() => {
                      const next = toggleReminder(draft, offset, reminderLimit);
                      setOverLimit(next.overLimit);
                      if (!next.overLimit) onChange(next.draft);
                    }}
                    testID={`event-reminder-${offset}`}
                  />
                ))}
              </View>
              {overLimit ? (
                <View style={gap} testID="event-reminders-limit">
                  <Text color="textSecondary">{t('calendar.editor.remindersLimit')}</Text>
                  <Button
                    variant="secondary"
                    label={t('calendar.editor.seePremium')}
                    onPress={onPremiumRequired}
                    testID="event-reminders-premium"
                  />
                </View>
              ) : null}
            </Group>

            {isParent ? (
              <Switch
                label={t('calendar.editor.shared')}
                description={t('calendar.editor.sharedHint')}
                value={draft.shared}
                onValueChange={(shared) => set({ shared, sharedChosen: true })}
                testID="event-shared"
              />
            ) : (
              <Text color="textSecondary" testID="event-shared-always">
                {t('calendar.editor.sharedAlways')}
              </Text>
            )}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
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
