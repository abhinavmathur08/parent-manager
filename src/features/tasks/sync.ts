// Registers the tasks tables with the household sync layer at module load (T-01.1).
// Imported by the tab layout, so the tables exist before the local copy opens.
import { defineSyncTable } from '@/lib/sync';

import { TASK_OCCURRENCES, TASKS } from './tables';

defineSyncTable(TASKS);
defineSyncTable(TASK_OCCURRENCES);
