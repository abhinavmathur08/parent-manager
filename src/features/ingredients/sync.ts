// Registers household ingredients with the household sync layer at module load (R-02.2).
// Imported by the tab layout, so the table exists before the local copy opens.
import { defineSyncTable } from '@/lib/sync';

import { HOUSEHOLD_INGREDIENTS } from './household';

defineSyncTable(HOUSEHOLD_INGREDIENTS);
