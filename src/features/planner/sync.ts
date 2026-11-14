// Registers the planner tables with the household sync layer at module load (P-01.1).
// Imported by the tab layout, so the tables exist before the local copy opens.
import { defineSyncTable } from '@/lib/sync';

import { PLAN_ENTRIES, PLAN_ENTRY_PORTIONS } from './tables';

defineSyncTable(PLAN_ENTRIES);
defineSyncTable(PLAN_ENTRY_PORTIONS);
