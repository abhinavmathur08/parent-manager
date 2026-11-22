import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';
import type { SyncRow } from '@/lib/sync/types';

import { draftValues, type EventDraft } from './editor';
import {
  exceptionId,
  EVENT_EXCEPTIONS,
  EVENT_PEOPLE,
  EVENT_REMINDERS,
  EVENTS,
  type EventExceptionRow,
  type EventPersonRow,
  type EventReminderRow,
  type EventRow,
} from './tables';

/** The fixed-value half of a kind's identifier, for analytics: `kind.appointment` is `appointment`. */
export function kindCode(kind: string): string {
  return kind.slice('kind.'.length);
}

/**
 * Adds an event, its people and its reminders through the sync layer, so it shows at once
 * and syncs when online (FR2-CAL-6). The server sets who created it; this device mirrors
 * that so the event reads correctly before it syncs.
 */
export function useCreateEvent(timeZone: string, userId: string | null) {
  const writer = useSyncWriter();
  return useCallback(
    async (draft: EventDraft): Promise<string> => {
      const id = randomUUID();
      const values = draftValues(draft, timeZone);
      await writer.insert(EVENTS.name, id, {
        ...values,
        created_by: userId,
        updated_by: userId,
      });
      for (const personId of draft.personIds) {
        await writer.insert(EVENT_PEOPLE.name, randomUUID(), { event_id: id, person_id: personId });
      }
      for (const offset of draft.reminders) {
        await writer.insert(EVENT_REMINDERS.name, randomUUID(), {
          event_id: id,
          offset_minutes: offset,
        });
      }
      // Fixed values and counts only: never the title, place, notes or names.
      track('event_created', {
        kind: kindCode(draft.kind),
        all_day: draft.allDay,
        repeats: values.repeat !== null,
        has_people: draft.personIds.length > 0,
        has_taking: draft.takingUserId !== null,
        shared: draft.shared,
        reminders: draft.reminders.length,
      });
      return id;
    },
    [writer, timeZone, userId],
  );
}

/**
 * Detail actions on an event (S-38, FR2-CAL-7, FR2-CAL-8). Deleting tombstones the event; the
 * server tombstones its people, reminders and exceptions with it.
 */
export function useEventActions(userId: string | null) {
  const writer = useSyncWriter();
  return {
    setTaking: async (event: EventRow, takingUserId: string | null) => {
      await writer.update(EVENTS.name, event.id, {
        taking_user_id: takingUserId,
        updated_by: userId,
      });
    },
    setShared: async (event: EventRow, shared: boolean) => {
      await writer.update(EVENTS.name, event.id, { shared, updated_by: userId });
      track('event_shared', { shared });
    },
    remove: async (event: EventRow) => {
      await writer.remove(EVENTS.name, event.id);
      track('event_deleted', { kind: kindCode(event.kind), scope: 'all' });
    },
  };
}

export type EventChildren = {
  people: readonly EventPersonRow[];
  reminders: readonly EventReminderRow[];
};

/**
 * Saves an edited event: its columns, then its people and reminders as the draft has them,
 * removing the rows that went and adding the ones that came (FR2-CAL-2).
 */
export function useUpdateEvent(timeZone: string, userId: string | null) {
  const writer = useSyncWriter();
  return useCallback(
    async (event: EventRow, draft: EventDraft, children: EventChildren): Promise<void> => {
      await writer.update(EVENTS.name, event.id, {
        ...draftValues(draft, timeZone),
        updated_by: userId,
      });
      const people = children.people.filter((row) => row.event_id === event.id);
      for (const row of people) {
        if (!draft.personIds.includes(row.person_id))
          await writer.remove(EVENT_PEOPLE.name, row.id);
      }
      for (const personId of draft.personIds) {
        if (people.some((row) => row.person_id === personId)) continue;
        await writer.insert(EVENT_PEOPLE.name, randomUUID(), {
          event_id: event.id,
          person_id: personId,
        });
      }
      const reminders = children.reminders.filter((row) => row.event_id === event.id);
      for (const row of reminders) {
        if (!draft.reminders.includes(row.offset_minutes)) {
          await writer.remove(EVENT_REMINDERS.name, row.id);
        }
      }
      for (const offset of draft.reminders) {
        if (reminders.some((row) => row.offset_minutes === offset)) continue;
        await writer.insert(EVENT_REMINDERS.name, randomUUID(), {
          event_id: event.id,
          offset_minutes: offset,
        });
      }
      track('event_updated', { kind: kindCode(draft.kind), scope: 'all' });
    },
    [writer, timeZone, userId],
  );
}

/**
 * One occurrence of a repeating event ("this event", FR2-CAL-4, R2-CAL-2). The exception's ID
 * comes from the event and the occurrence's original date, so two devices write one row; a
 * live row is updated, since clients never delete exceptions.
 */
export function useOccurrenceWrites(timeZone: string) {
  const writer = useSyncWriter();
  const write = async (
    event: EventRow,
    originalDate: string,
    exceptions: readonly EventExceptionRow[],
    values: Omit<EventExceptionRow, keyof SyncRow | 'event_id' | 'original_date'>,
  ) => {
    const id = exceptionId(event.id, originalDate);
    if (exceptions.some((row) => row.id === id && !row.deleted_at)) {
      await writer.update(EVENT_EXCEPTIONS.name, id, values);
    } else {
      await writer.insert(EVENT_EXCEPTIONS.name, id, {
        event_id: event.id,
        original_date: originalDate,
        ...values,
      });
    }
  };
  return {
    /** Moves one occurrence, or changes who's taking it; the series stays as it is. */
    move: async (
      event: EventRow,
      originalDate: string,
      draft: EventDraft,
      exceptions: readonly EventExceptionRow[],
    ) => {
      const values = draftValues(draft, timeZone);
      await write(event, originalDate, exceptions, {
        status: 'moved',
        starts_at: values.starts_at,
        ends_at: values.ends_at,
        start_date: values.start_date,
        end_date: values.end_date,
        taking_user_id: values.taking_user_id,
      });
      track('event_updated', { kind: kindCode(event.kind), scope: 'one' });
    },
    /** Deletes one occurrence from the series. */
    skip: async (
      event: EventRow,
      originalDate: string,
      exceptions: readonly EventExceptionRow[],
    ) => {
      await write(event, originalDate, exceptions, {
        status: 'skipped',
        starts_at: null,
        ends_at: null,
        start_date: null,
        end_date: null,
        taking_user_id: null,
      });
      track('event_deleted', { kind: kindCode(event.kind), scope: 'one' });
    },
  };
}
