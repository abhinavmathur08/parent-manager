import { catalogIngredient } from '@/features/ingredients/catalog';
import { buildIngredients } from '@/features/ingredients/use-ingredients';
import { planSave, validateDraft } from '@/features/recipes/draft';
import {
  NEW_PARENT_TAGS,
  STARTER_LIBRARY_VERSION,
  STARTER_RECIPES,
  starterText,
} from '@/features/recipes/starter/library';
import { copyStarter, starterEntry, starterView } from '@/features/recipes/starter/view';
import { RECIPE_LIMITS, RECIPE_TAGS } from '@/features/recipes/tables';
import { UNITS } from '@/i18n';

describe('starter library seed data (R-04.1, FR-REC-2)', () => {
  it('is versioned and has unique keys the database accepts', () => {
    expect(STARTER_LIBRARY_VERSION).toBeGreaterThanOrEqual(1);
    const keys = STARTER_RECIPES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^starter\.[a-z0-9_]+$/);
  });

  it.each(STARTER_RECIPES.map((r) => [r.key, r] as const))(
    '%s uses catalog ingredient and unit IDs and a new-parent tag',
    (_, recipe) => {
      for (const line of recipe.lines) {
        expect(catalogIngredient(line.ingredientId)).toBeDefined();
        if (line.unitId)
          expect(line.unitId in UNITS || ['unit.pinch', 'unit.dash'].includes(line.unitId)).toBe(
            true,
          );
      }
      for (const tag of recipe.tags) expect(RECIPE_TAGS).toContain(tag);
      expect(recipe.tags.some((tag) => NEW_PARENT_TAGS.includes(tag))).toBe(true);
      expect(recipe.servings).toBeGreaterThanOrEqual(RECIPE_LIMITS.minServings);
      expect(recipe.servings).toBeLessThanOrEqual(RECIPE_LIMITS.maxServings);
      for (const locale of ['en-US', 'en-GB', 'en-AU']) {
        const text = starterText(recipe, locale);
        expect(text.title.length).toBeGreaterThan(0);
        expect(text.steps.length).toBeGreaterThan(0);
      }
    },
  );

  it('falls back to en-US text and uses the locale where there is one', () => {
    const oats = STARTER_RECIPES.find((r) => r.key === 'starter.overnight_oats')!;
    expect(starterText(oats, 'en-GB').steps[0]).toMatch(/yoghurt/);
    expect(starterText(oats, 'en-AU').steps[0]).toMatch(/yogurt/);
  });

  it('shows on S-16 and S-17 with catalog names, read-only', () => {
    const ingredients = buildIngredients('en-US', []);
    const recipe = STARTER_RECIPES[0];
    expect(starterEntry(recipe, 'en-US', ingredients.name).ingredientNames).toContain(
      'rolled oats',
    );
    const view = starterView(recipe, 'en-US');
    expect(view).toMatchObject({ id: recipe.key, sourceType: 'library', title: 'Overnight oats' });
    expect(view.lines).toHaveLength(recipe.lines.length);
  });
});

describe('save a copy (FR-REC-3)', () => {
  const recipe = STARTER_RECIPES[1];
  let n = 0;
  const newId = () => `id-${++n}`;

  it('writes an editable household recipe linked to the starter', () => {
    const draft = copyStarter(recipe, 'en-US', newId);
    expect(validateDraft(draft)).toEqual({});
    const ops = planSave(null, draft, {
      recipeId: 'copy-1',
      locale: 'en-US',
      dimension: (id) => buildIngredients('en-US', []).dimension(id),
      origin: { sourceType: 'library', libraryRecipeId: recipe.key },
    });
    expect(ops[0]).toMatchObject({
      kind: 'insert',
      table: 'recipes',
      id: 'copy-1',
      values: {
        title: 'Lentil and tomato soup',
        source_type: 'library',
        library_recipe_id: recipe.key,
      },
    });
    expect(ops.filter((o) => o.table === 'recipe_ingredients')).toHaveLength(recipe.lines.length);
    expect(ops.filter((o) => o.table === 'recipe_steps')).toHaveLength(
      recipe.text['en-US'].steps.length,
    );
  });

  it('is independent: editing the copy leaves the starter as it was', () => {
    const before = JSON.stringify(recipe);
    const draft = copyStarter(recipe, 'en-US', newId);
    draft.lines[0].quantity = 99;
    draft.steps[0].text = 'Changed';
    draft.tags.push('tag.quick');
    expect(JSON.stringify(recipe)).toBe(before);
    expect(new Set(draft.lines.map((l) => l.id)).size).toBe(recipe.lines.length);
  });
});
