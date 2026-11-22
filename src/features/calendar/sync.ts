// Registers the calendar tables with the household sync layer at module load (C-01.1).
// Imported by the tab layout, so the tables exist before the local copy opens.
import { defineSyncTable } from '@/lib/sync';

import {
  BUSY_BLOCKS,
  BUSY_DAY_OVERRIDES,
  BUSY_DAYS,
  EVENT_EXCEPTIONS,
  EVENT_PEOPLE,
  EVENT_REMINDERS,
  EVENTS,
} from './tables';

defineSyncTable(EVENTS);
defineSyncTable(EVENT_PEOPLE);
defineSyncTable(EVENT_REMINDERS);
defineSyncTable(EVENT_EXCEPTIONS);
defineSyncTable(BUSY_BLOCKS);
defineSyncTable(BUSY_DAY_OVERRIDES);
defineSyncTable(BUSY_DAYS);
