import { ALLERGEN_CODES } from '@/features/ingredients/catalog-ids';
import { RECIPE_TAGS } from '@/features/recipes/tables';
import { REGIONAL_UNITS, UNITS, UNMEASURED_UNITS } from '@/i18n';

import * as server from '../../supabase/functions/import-recipe/vocabulary';

// The import function can't import the app's lists, so it keeps copies. They must match, or
// the model would be offered units, tags or allergens the app doesn't know (spec AI-1, AI-2).
describe('import function vocabulary', () => {
  it('offers exactly the units a recipe line can use', () => {
    expect([...server.UNIT_IDS].sort()).toEqual(
      [...Object.keys(UNITS), ...UNMEASURED_UNITS].sort(),
    );
  });

  it('reads regional unit words the same way as the app', () => {
    expect(server.REGIONAL_UNITS).toEqual(REGIONAL_UNITS);
  });

  it('uses the same tags and allergen codes', () => {
    expect(server.RECIPE_TAGS).toEqual(RECIPE_TAGS);
    expect(server.ALLERGEN_CODES).toEqual(ALLERGEN_CODES);
  });
});
