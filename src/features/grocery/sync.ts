// Registers the grocery and pantry tables with the household sync layer at module load
// (G-01.3). Imported by the tab layout, so the tables exist before the local copy opens.
import { PANTRY_ITEMS } from '@/features/pantry/tables';
import { defineSyncTable } from '@/lib/sync';

import { FREQUENT_SUGGESTION_HIDES } from './frequent';
import { GROCERY_ITEM_SOURCES, GROCERY_ITEMS, GROCERY_LISTS, PURCHASE_EVENTS } from './tables';

defineSyncTable(GROCERY_LISTS);
defineSyncTable(GROCERY_ITEMS);
defineSyncTable(GROCERY_ITEM_SOURCES);
defineSyncTable(PURCHASE_EVENTS);
defineSyncTable(FREQUENT_SUGGESTION_HIDES);
defineSyncTable(PANTRY_ITEMS);
