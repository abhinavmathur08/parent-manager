import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { draftValues, type EventDraft } from './editor';
import {
  EVENT_PEOPLE,
  EVENT_REMINDERS,
  EVENTS,
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
      await writer.insert(EVENTS.name, id, {
        ...draftValues(draft, timeZone),
        repeat: null,
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
        repeats: false,
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
