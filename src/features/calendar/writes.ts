import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { draftValues, type EventDraft } from './editor';
import { EVENT_PEOPLE, EVENT_REMINDERS, EVENTS } from './tables';

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
