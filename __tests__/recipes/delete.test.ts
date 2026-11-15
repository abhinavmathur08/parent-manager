import { planRecipeDeletion, type DeletionEntry } from '@/features/recipes/delete';
import {
  hasTag,
  isRecipeTag,
  NEEDS_DEFROSTING_TAG,
  RECIPE_TAGS,
  tagNameKey,
} from '@/features/recipes/tables';
import enUS from '@/i18n/locales/en-US.json';

const entry = (id: string, date: string, extra: Partial<DeletionEntry> = {}): DeletionEntry => ({
  id,
  date,
  recipe_id: 'chili',
  free_text: null,
  deleted_at: null,
  ...extra,
});

describe('planRecipeDeletion (R-02.3, FR-REC-11)', () => {
  const chili = { id: 'chili', title: 'Chili' };

  it('keeps the title as free text on every live entry that plans it, then removes the recipe', () => {
    const result = planRecipeDeletion(
      chili,
      [
        entry('past', '2026-11-02'),
        entry('now', '2026-11-09'),
        entry('later', '2026-11-20'),
        entry('removed', '2026-11-10', { deleted_at: '2026-11-10T00:00:00Z' }),
        entry('other', '2026-11-10', { recipe_id: 'pancakes' }),
      ],
      '2026-11-09',
    );
    expect(result.ops).toEqual([
      {
        kind: 'update',
        table: 'plan_entries',
        id: 'past',
        values: { recipe_id: null, free_text: 'Chili' },
      },
      {
        kind: 'update',
        table: 'plan_entries',
        id: 'now',
        values: { recipe_id: null, free_text: 'Chili' },
      },
      {
        kind: 'update',
        table: 'plan_entries',
        id: 'later',
        values: { recipe_id: null, free_text: 'Chili' },
      },
      { kind: 'remove', table: 'recipes', id: 'chili' },
    ]);
    expect(result.affected).toBe(3);
  });

  it('counts only entries from the start of the current week as upcoming', () => {
    const result = planRecipeDeletion(
      chili,
      [entry('a', '2026-11-08'), entry('b', '2026-11-09'), entry('c', '2026-12-01')],
      '2026-11-09',
    );
    expect(result.upcoming).toBe(2);
  });

  it('only removes the recipe when nothing plans it', () => {
    expect(planRecipeDeletion(chili, [], '2026-11-09')).toEqual({
      affected: 0,
      upcoming: 0,
      ops: [{ kind: 'remove', table: 'recipes', id: 'chili' }],
    });
  });
});

describe('recipe tags (FR-REC-7, spec C-4)', () => {
  it('include needs-defrosting as a stable ID', () => {
    expect(NEEDS_DEFROSTING_TAG).toBe('tag.needs_defrosting');
    expect(RECIPE_TAGS).toContain(NEEDS_DEFROSTING_TAG);
  });

  it('are matched by ID, never by name', () => {
    expect(hasTag({ tags: ['tag.needs_defrosting'] }, NEEDS_DEFROSTING_TAG)).toBe(true);
    expect(hasTag({ tags: ['Needs defrosting'] }, NEEDS_DEFROSTING_TAG)).toBe(false);
    expect(hasTag({ tags: null }, NEEDS_DEFROSTING_TAG)).toBe(false);
    expect(isRecipeTag('tag.no_cook')).toBe(true);
    expect(isRecipeTag('No-cook')).toBe(false);
  });

  it('each have a name in the locale files', () => {
    const names = enUS.recipes.tags as Record<string, string>;
    for (const tag of RECIPE_TAGS) {
      const key = tagNameKey(tag);
      expect(key).toMatch(/^recipes\.tags\./);
      expect(names[key.slice('recipes.tags.'.length)]).toEqual(expect.any(String));
    }
  });
});
