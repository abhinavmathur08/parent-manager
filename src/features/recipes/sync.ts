// Registers the recipe tables with the household sync layer at module load (R-02.1).
// Imported by the tab layout, so the tables exist before the local copy opens.
import { defineSyncTable } from '@/lib/sync';

import { RECIPE_INGREDIENTS, RECIPE_STEPS, RECIPES } from './tables';

defineSyncTable(RECIPES);
defineSyncTable(RECIPE_INGREDIENTS);
defineSyncTable(RECIPE_STEPS);
