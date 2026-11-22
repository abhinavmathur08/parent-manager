import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { RadioOption } from '@/components/radio-option';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { Toast } from '@/components/toast';
import type { MemberRole } from '@/features/household/invitations';
import { usePlanPeople } from '@/features/planner/use-plan-people';
import { useUndoable } from '@/features/planner/use-undoable';
import { addDays, toDate, type PlanDate } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatList, formatTime, type AppLocale } from '@/i18n';

import { startOfDay } from './agenda';
import { kindKey } from './agenda-screen';
import { useCalendarRows } from './data';
import { eventPermissions } from './permissions';
import { repeatFromRule } from './editor';
import { expandOccurrences, parseRepeat, type Occurrence } from './repeat';
import { REMINDER_OFFSETS, type EventRow } from './tables';
import { useCalendarMembers } from './use-members';
import type { EditTarget } from './use-event-editor';
import { useEventActions, useOccurrenceWrites } from './writes';

export type EventDetailProps = {
  eventId: string;
  /** The occurrence's original date, for a repeating event. */
  date: PlanDate | null;
  household: { id: string; locale: AppLocale; timeZone: string };
  role: MemberRole;
  userId: string | null;
  onBack: () => void;
  /** Opens the editor for the series, or for one occurrence ("this event", FR2-CAL-4). */
  onEdit: (event: EventRow, children: EditTarget, occurrence: Occurrence | null) => void;
  /** After the member takes it: answers a "who's taking?" prompt when opened from one. */
  onTaken?: () => void;
};

const DATE_FORMAT = { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;

/**
 * S-38 event detail (FR2-CAL-7, FR2-CAL-8): kind, time, for, taking, place, notes, reminders
 * and who last changed it. Any member who can see it can take it themselves; parents share
 * and unshare; whoever may edit can delete it, with a 5-second undo.
 */
export function EventDetailScreen({
  eventId,
  date,
  household,
  role,
  userId,
  onBack,
  onEdit,
  onTaken,
}: EventDetailProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale, timeZone } = household;
  const rows = useCalendarRows();
  const people = usePlanPeople(household.id).people;
  const members = useCalendarMembers(household.id);
  const actions = useEventActions(userId);
  const fail = () => Alert.alert(t('calendar.detail.failed'));
  const undoable = useUndoable(fail);
  const [deleted, setDeleted] = useState(false);
  const occurrenceWrites = useOccurrenceWrites(timeZone);
  /** Asking "this event" or "all events" before an edit or delete of a repeating event. */
  const [scoping, setScoping] = useState<'edit' | 'delete' | null>(null);

  const event = rows.events.find((row) => row.id === eventId) ?? null;
  const occurrence = useMemo(() => {
    if (!event) return null;
    const day = date ?? event.start_date ?? null;
    const from = day ? startOfDay(day, timeZone) : Date.parse(event.starts_at ?? '');
    const found = expandOccurrences(event, {
      timeZone,
      from: new Date(from),
      to: new Date(day ? startOfDay(addDays(day, 1), timeZone) : from + 1),
      exceptions: rows.exceptions,
    });
    return found.find((o) => !date || o.originalDate === date) ?? found[0] ?? null;
  }, [event, date, timeZone, rows.exceptions]);

  const nameOf = (memberId: string | null) => {
    if (!memberId) return t('calendar.detail.nobody');
    if (memberId === userId) return t('calendar.detail.you');
    return members.find((m) => m.userId === memberId)?.displayName ?? t('calendar.detail.member');
  };

  if (!event || deleted) {
    return (
      <View style={styles.grow}>
        <Screen title={t('calendar.detail.title')} onBack={onBack} hasTabBar testID="event-detail">
          {!deleted ? (
            <EmptyState icon="calendar" message={t('calendar.detail.gone')} testID="event-gone" />
          ) : null}
        </Screen>
        <Toast
          visible={undoable.current !== null}
          message={undoable.current?.message ?? ''}
          variant="undo"
          actionLabel={t('calendar.detail.undo')}
          onAction={() => {
            undoable.undo();
            setDeleted(false);
          }}
          onDismiss={() => {
            undoable.settle();
            onBack();
          }}
          testID="event-undo"
        />
      </View>
    );
  }

  const can = eventPermissions(event, role, userId);
  const children = {
    people: rows.people,
    reminders: rows.reminders,
    exceptions: rows.exceptions,
  };
  const repeats = parseRepeat(event.repeat) !== null && occurrence !== null;
  const forNames = rows.people
    .filter((row) => row.event_id === event.id)
    .map((row) => people.find((p) => p.id === row.person_id)?.displayName)
    .filter((name): name is string => Boolean(name));
  const reminders = REMINDER_OFFSETS.filter((offset) =>
    rows.reminders.some((row) => row.event_id === event.id && row.offset_minutes === offset),
  );
  const takingId = occurrence?.takingUserId ?? event.taking_user_id;

  const when = (() => {
    if (!occurrence) return '';
    if (occurrence.allDay) {
      const start = formatDate(toDate(occurrence.startDate!), locale, DATE_FORMAT);
      return occurrence.endDate === occurrence.startDate
        ? t('calendar.detail.allDayOn', { date: start })
        : t('calendar.timeRange', {
            start,
            end: formatDate(toDate(occurrence.endDate!), locale, DATE_FORMAT),
          });
    }
    const start = new Date(occurrence.startsAt!);
    return t('calendar.detail.when', {
      date: formatDate(start, locale, { ...DATE_FORMAT, timeZone }),
      time: t('calendar.timeRange', {
        start: formatTime(start, locale, timeZone),
        end: formatTime(new Date(occurrence.endsAt!), locale, timeZone),
      }),
    });
  })();

  const run = (task: () => Promise<void>) => void task().catch(fail);

  /** Hidden at once, written when the 5-second undo goes (FR2-CAL-8, NFR-REL-5). */
  const remove = (scope: 'one' | 'all') => {
    setDeleted(true);
    undoable.hold({
      message: t('calendar.detail.deleted'),
      hidden: [event.id],
      commit: () =>
        scope === 'one' && occurrence
          ? occurrenceWrites.skip(event, occurrence.originalDate, rows.exceptions)
          : actions.remove(event),
    });
  };

  /** A whole series is deleted only after a confirmation (FR2-CAL-8). */
  const removeSeries = () =>
    Alert.alert(
      t('calendar.detail.deleteSeriesTitle'),
      t('calendar.detail.deleteSeriesBody', { title: event.title }),
      [
        { text: t('calendar.detail.cancel'), style: 'cancel' },
        {
          text: t('calendar.detail.deleteSeries'),
          style: 'destructive',
          onPress: () => remove('all'),
        },
      ],
    );

  const choose = (scope: 'one' | 'all') => {
    const action = scoping;
    setScoping(null);
    if (action === 'edit') onEdit(event, children, scope === 'one' ? occurrence : null);
    else if (scope === 'one') remove('one');
    else removeSeries();
  };

  return (
    <View style={styles.grow}>
      <Screen title={event.title} onBack={onBack} testID="event-detail">
        <Card testID="event-detail-summary">
          <View style={{ gap: theme.space[1] }}>
            <Text variant="label" color="textSecondary">
              {t(kindKey(event.kind))}
            </Text>
            <Text variant="bodyStrong" testID="event-detail-when">
              {when}
            </Text>
          </View>
        </Card>

        <Card testID="event-detail-fields">
          <View style={{ gap: theme.space[3] }}>
            {forNames.length > 0 ? (
              <Field
                label={t('calendar.detail.for')}
                value={formatList(forNames, locale)}
                testID="event-detail-for"
              />
            ) : null}
            <Field
              label={t('calendar.detail.taking')}
              value={nameOf(takingId)}
              testID="event-detail-taking"
            />
            {event.place ? (
              <Field
                label={t('calendar.detail.place')}
                value={event.place}
                testID="event-detail-place"
              />
            ) : null}
            {event.notes ? (
              <Field
                label={t('calendar.detail.notes')}
                value={event.notes}
                testID="event-detail-notes"
              />
            ) : null}
            <Field
              label={t('calendar.detail.reminders')}
              value={
                reminders.length
                  ? formatList(
                      reminders.map((o) => t(`calendar.reminders.${o}`)),
                      locale,
                    )
                  : t('calendar.detail.noReminders')
              }
              testID="event-detail-reminders"
            />
            {repeats ? (
              <Field
                label={t('calendar.detail.repeats')}
                value={t(
                  `calendar.repeat.${repeatFromRule(event.repeat, occurrence.originalDate).choice}`,
                )}
                testID="event-detail-repeats"
              />
            ) : null}
            {event.updated_by ? (
              <Text variant="caption" color="textSecondary" testID="event-detail-changed-by">
                {t('calendar.detail.changedBy', { name: nameOf(event.updated_by) })}
              </Text>
            ) : null}
          </View>
        </Card>

        {can.canTake ? (
          takingId === userId ? (
            <Button
              variant="secondary"
              label={t('calendar.detail.stepBack')}
              onPress={() => run(() => actions.setTaking(event, null))}
              testID="event-step-back"
            />
          ) : (
            <Button
              label={t('calendar.detail.takeIt')}
              onPress={() =>
                run(async () => {
                  await actions.setTaking(event, userId);
                  onTaken?.();
                })
              }
              testID="event-take"
            />
          )
        ) : null}

        {can.canShare ? (
          <Switch
            label={t('calendar.detail.shared')}
            description={t('calendar.detail.sharedHint')}
            value={event.shared}
            onValueChange={(shared) => run(() => actions.setShared(event, shared))}
            testID="event-share"
          />
        ) : null}

        {can.canEdit ? (
          <View style={{ gap: theme.space[2] }}>
            <Button
              variant="secondary"
              label={t('calendar.detail.edit')}
              onPress={() => (repeats ? setScoping('edit') : onEdit(event, children, null))}
              testID="event-edit"
            />
            <Button
              variant="destructive"
              label={t('calendar.detail.delete')}
              onPress={() => (repeats ? setScoping('delete') : remove('all'))}
              testID="event-delete"
            />
          </View>
        ) : null}
      </Screen>
      <BottomSheet
        visible={scoping !== null}
        onClose={() => setScoping(null)}
        title={t(scoping === 'delete' ? 'calendar.scope.deleteTitle' : 'calendar.scope.editTitle')}
        testID="event-scope"
      >
        <View style={{ gap: theme.space[3] }}>
          <RadioOption
            label={t('calendar.scope.one')}
            description={t('calendar.scope.oneHint')}
            selected={false}
            onPress={() => choose('one')}
            testID="event-scope-one"
          />
          <RadioOption
            label={t('calendar.scope.all')}
            description={t('calendar.scope.allHint')}
            selected={false}
            onPress={() => choose('all')}
            testID="event-scope-all"
          />
        </View>
      </BottomSheet>
    </View>
  );
}

function Field({ label, value, testID }: { label: string; value: string; testID: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1] }} testID={testID}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ grow: { flex: 1 } });
