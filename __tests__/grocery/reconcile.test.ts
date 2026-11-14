import type { Need } from '@/features/grocery/engine';
import {
  generatedItemId,
  itemSourceId,
  reconcileList,
  type ReconcileResult,
} from '@/features/grocery/reconcile';
import { stableId } from '@/features/grocery/stable-id';
import type { GroceryItemRow, GroceryItemSourceRow } from '@/features/grocery/tables';
import type { SaveOp } from '@/features/recipes/draft';

const LIST = 'list-1';
const EGGS = 'ingredient.egg|count';

const need = (
  key: string,
  quantityBase: number | null,
  sources: [string, string, number | null][] = [['e1', 'l1', quantityBase]],
): Need => {
  const [ingredientId, dim] = key.split('|');
  return {
    key,
    ingredientId,
    dimension: dim === 'none' ? null : (dim as Need['dimension']),
    quantityBase,
    sectionId: 'section.dairy',
    sources: sources.map(([entryId, lineId, q]) => ({ entryId, lineId, quantityBase: q })),
  };
};

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const item = (over: Partial<GroceryItemRow> & { id: string }): GroceryItemRow => ({
  ...base,
  list_id: LIST,
  ingredient_id: 'ingredient.egg',
  custom_name: null,
  dimension: 'count',
  quantity_base: 6,
  display_unit_id: null,
  section_id: 'section.dairy',
  origin: 'plan',
  plan_quantity_base: 6,
  user_modified: false,
  plan_changed: false,
  checked: false,
  checked_at: null,
  checked_by: null,
  ...over,
});

type State = { items: GroceryItemRow[]; sources: GroceryItemSourceRow[] };

/** Applies ops the way the sync layer would on the device. */
function apply(state: State, ops: readonly SaveOp[]): State {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    grocery_items: new Map(state.items.map((r) => [r.id, { ...r }])),
    grocery_item_sources: new Map(state.sources.map((r) => [r.id, { ...r }])),
  };
  for (const op of ops) {
    const table = tables[op.table];
    if (op.kind === 'insert') table.set(op.id, { ...base, id: op.id, ...op.values });
    else if (op.kind === 'update') table.set(op.id, { ...table.get(op.id), ...op.values });
    else table.set(op.id, { ...table.get(op.id), deleted_at: 'deleted' });
  }
  return {
    items: [...tables.grocery_items.values()] as GroceryItemRow[],
    sources: [...tables.grocery_item_sources.values()] as GroceryItemSourceRow[],
  };
}

function run(state: State, needs: Need[]): ReconcileResult & { state: State } {
  const result = reconcileList({ listId: LIST, needs, ...state });
  return { ...result, state: apply(state, result.ops) };
}

const liveItems = (state: State) => state.items.filter((i) => !i.deleted_at);
const liveSources = (state: State, itemId: string) =>
  state.sources.filter((s) => s.item_id === itemId && !s.deleted_at);
const empty: State = { items: [], sources: [] };

describe('reconcileList (R-LIST-4)', () => {
  it('creates an item for a new group, with its sources and a stable ID', () => {
    const { state, summary } = run(empty, [
      need(EGGS, 6, [
        ['e1', 'l1', 4],
        ['e2', 'l2', 2],
      ]),
    ]);
    const [eggs] = liveItems(state);
    expect(eggs).toMatchObject({
      id: generatedItemId(LIST, EGGS, 0),
      ingredient_id: 'ingredient.egg',
      dimension: 'count',
      quantity_base: 6,
      plan_quantity_base: 6,
      origin: 'plan',
      section_id: 'section.dairy',
      user_modified: false,
      checked: false,
    });
    expect(
      liveSources(state, eggs.id).map((s) => [
        s.plan_entry_id,
        s.recipe_ingredient_id,
        s.quantity_base,
      ]),
    ).toEqual([
      ['e1', 'l1', 4],
      ['e2', 'l2', 2],
    ]);
    expect(liveSources(state, eggs.id)[0].id).toBe(itemSourceId(eggs.id, 'e1', 'l1'));
    expect(summary).toEqual({ added: 1, changed: 0, removed: 0 });
  });

  it('changes nothing when run again on its own result', () => {
    const first = run(empty, [need(EGGS, 6)]);
    expect(reconcileList({ listId: LIST, needs: [need(EGGS, 6)], ...first.state }).ops).toEqual([]);
  });

  it('updates the quantity and sources of an unchecked, unmodified item', () => {
    const first = run(empty, [need(EGGS, 6)]);
    const { state, summary } = run(first.state, [
      need(EGGS, 8, [
        ['e1', 'l1', 6],
        ['e3', 'l3', 2],
      ]),
    ]);
    const [eggs] = liveItems(state);
    expect(eggs).toMatchObject({ quantity_base: 8, plan_quantity_base: 8 });
    expect(liveSources(state, eggs.id).map((s) => s.plan_entry_id)).toEqual(['e1', 'e3']);
    expect(liveSources(state, eggs.id)[0].quantity_base).toBe(6);
    expect(summary).toEqual({ added: 0, changed: 1, removed: 0 });
  });

  it('adds a new item for the difference when more is needed after checking off (spec 3.8)', () => {
    const checked = item({ id: 'a', checked: true, checked_at: 't', checked_by: 'u' });
    const { state, summary, ops } = run({ items: [checked], sources: [] }, [need(EGGS, 8)]);
    expect(ops.some((op) => op.id === 'a')).toBe(false);
    const open = liveItems(state).filter((i) => !i.checked);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      quantity_base: 2,
      plan_quantity_base: 2,
      id: generatedItemId(LIST, EGGS, 1),
    });
    expect(summary.added).toBe(1);
  });

  it('leaves a checked item alone when the need stays or falls', () => {
    const checked = item({ id: 'a', checked: true });
    expect(
      reconcileList({ listId: LIST, needs: [need(EGGS, 6)], items: [checked], sources: [] }).ops,
    ).toEqual([]);
    expect(
      reconcileList({ listId: LIST, needs: [need(EGGS, 2)], items: [checked], sources: [] }).ops,
    ).toEqual([]);
    expect(reconcileList({ listId: LIST, needs: [], items: [checked], sources: [] }).ops).toEqual(
      [],
    );
  });

  it('removes the extra item again when the need falls back to what was checked', () => {
    const checked = item({ id: 'a', checked: true });
    const more = run({ items: [checked], sources: [] }, [need(EGGS, 8)]);
    const { state, summary } = run(more.state, [need(EGGS, 6)]);
    expect(liveItems(state).map((i) => i.id)).toEqual(['a']);
    expect(summary.removed).toBe(1);
  });

  it('keeps a user-modified quantity, updates its sources and flags the plan change', () => {
    const edited = item({ id: 'a', quantity_base: 12, user_modified: true });
    const { state, summary } = run({ items: [edited], sources: [] }, [
      need(EGGS, 8, [['e9', 'l9', 8]]),
    ]);
    const [eggs] = liveItems(state);
    expect(eggs).toMatchObject({
      id: 'a',
      quantity_base: 12,
      plan_quantity_base: 8,
      plan_changed: true,
    });
    expect(liveSources(state, 'a').map((s) => s.plan_entry_id)).toEqual(['e9']);
    expect(liveItems(state)).toHaveLength(1);
    expect(summary.changed).toBe(1);
  });

  it('does not flag a user-modified item when the plan is unchanged', () => {
    const edited = item({ id: 'a', quantity_base: 12, user_modified: true });
    const { state } = run({ items: [edited], sources: [] }, [need(EGGS, 6)]);
    expect(liveItems(state)[0].plan_changed).toBe(false);
  });

  it('deletes unchecked, unmodified items when the group is no longer needed, and keeps the rest', () => {
    const plain = item({ id: 'a' });
    const edited = item({
      id: 'b',
      ingredient_id: 'ingredient.milk',
      dimension: 'volume',
      user_modified: true,
    });
    const checked = item({
      id: 'c',
      ingredient_id: 'ingredient.flour',
      dimension: 'mass',
      checked: true,
    });
    const { state, summary } = run({ items: [plain, edited, checked], sources: [] }, []);
    expect(liveItems(state).map((i) => i.id)).toEqual(['b', 'c']);
    expect(state.items.find((i) => i.id === 'a')?.plan_quantity_base).toBe(0);
    expect(liveItems(state).find((i) => i.id === 'b')).toMatchObject({
      plan_quantity_base: 0,
      plan_changed: true,
    });
    expect(summary.removed).toBe(1);
  });

  it('brings a group back after a deletion by recalculation', () => {
    const first = run(empty, [need(EGGS, 6)]);
    const gone = run(first.state, []);
    const { state } = run(gone.state, [need(EGGS, 4)]);
    expect(liveItems(state)).toEqual([
      expect.objectContaining({ id: generatedItemId(LIST, EGGS, 1), quantity_base: 4 }),
    ]);
  });

  it('does not recreate an item a member deleted unless the need rises, then adds the rise (FR-LIST-7)', () => {
    const deleted = item({ id: 'a', deleted_at: 'by member' });
    const same = reconcileList({
      listId: LIST,
      needs: [need(EGGS, 6)],
      items: [deleted],
      sources: [],
    });
    expect(same.ops).toEqual([]);
    const lower = reconcileList({
      listId: LIST,
      needs: [need(EGGS, 4)],
      items: [deleted],
      sources: [],
    });
    expect(lower.ops).toEqual([]);
    const { state } = run({ items: [deleted], sources: [] }, [need(EGGS, 9)]);
    expect(liveItems(state)).toEqual([expect.objectContaining({ quantity_base: 3 })]);
  });

  it('merges duplicate generated items into one', () => {
    const { state } = run({ items: [item({ id: 'b' }), item({ id: 'a' })], sources: [] }, [
      need(EGGS, 6),
    ]);
    expect(liveItems(state).map((i) => i.id)).toEqual(['a']);
  });

  it('gives two devices the same rows for the same inputs (R-LIST-7)', () => {
    const needs = [need(EGGS, 6), need('ingredient.milk|volume', 500)];
    const a = reconcileList({ listId: LIST, needs, items: [], sources: [] });
    const b = reconcileList({ listId: LIST, needs: [...needs].reverse(), items: [], sources: [] });
    expect(b.ops).toEqual(a.ops);
  });

  it('only touches its own list', () => {
    const other = item({ id: 'x', list_id: 'list-2' });
    const { ops } = reconcileList({ listId: LIST, needs: [], items: [other], sources: [] });
    expect(ops).toEqual([]);
  });

  describe('no-quantity items (R-ING-4)', () => {
    const PARSLEY = 'ingredient.parsley|none';

    it('creates one, keeps it, and removes it when no longer needed', () => {
      const first = run(empty, [need(PARSLEY, null)]);
      expect(liveItems(first.state)).toEqual([
        expect.objectContaining({ dimension: null, quantity_base: null, plan_quantity_base: null }),
      ]);
      expect(
        reconcileList({ listId: LIST, needs: [need(PARSLEY, null)], ...first.state }).ops,
      ).toEqual([]);
      const gone = run(first.state, []);
      expect(liveItems(gone.state)).toEqual([]);
      const back = run(gone.state, [need(PARSLEY, null)]);
      expect(liveItems(back.state)).toHaveLength(1);
    });

    it('does not come back after a member deleted it, or once checked', () => {
      const deleted = item({
        id: 'a',
        ingredient_id: 'ingredient.parsley',
        dimension: null,
        quantity_base: null,
        plan_quantity_base: null,
        deleted_at: 'x',
      });
      expect(
        reconcileList({ listId: LIST, needs: [need(PARSLEY, null)], items: [deleted], sources: [] })
          .ops,
      ).toEqual([]);
      const checked = { ...deleted, deleted_at: null, checked: true };
      expect(
        reconcileList({ listId: LIST, needs: [need(PARSLEY, null)], items: [checked], sources: [] })
          .ops,
      ).toEqual([]);
    });
  });
});

describe('reconcileList (R-LIST-5)', () => {
  const manual = (over: Partial<GroceryItemRow> & { id: string }) =>
    item({ origin: 'manual', plan_quantity_base: null, ...over });

  it('never changes manual items, even for an ingredient the plan needs', () => {
    const milk = manual({ id: 'm', ingredient_id: 'ingredient.egg', quantity_base: 2 });
    const diapers = manual({
      id: 'd',
      ingredient_id: null,
      custom_name: 'Diapers',
      dimension: null,
      quantity_base: null,
    });
    const { ops, state } = run({ items: [milk, diapers], sources: [] }, [need(EGGS, 6)]);
    expect(ops.filter((op) => op.id === 'm' || op.id === 'd')).toEqual([]);
    expect(liveItems(state)).toHaveLength(3);
  });

  it('keeps two free-text items with the same name as two rows', () => {
    const a = manual({
      id: 'a',
      ingredient_id: null,
      custom_name: 'Wipes',
      dimension: null,
      quantity_base: null,
    });
    const b = { ...a, id: 'b' };
    expect(reconcileList({ listId: LIST, needs: [], items: [a, b], sources: [] }).ops).toEqual([]);
  });

  it('merges two manual rows of the same ingredient added on two devices, summing them', () => {
    const a = manual({ id: stableId('a'), quantity_base: 2 });
    const b = manual({ id: stableId('b'), quantity_base: 3 });
    const [keep, drop] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));
    const { state } = run({ items: [b, a], sources: [] }, []);
    expect(liveItems(state)).toEqual([expect.objectContaining({ id: keep.id, quantity_base: 5 })]);
    expect(state.items.find((i) => i.id === drop.id)?.deleted_at).toBeTruthy();
  });

  it('does not merge a checked manual row', () => {
    const a = manual({ id: 'a', quantity_base: 2, checked: true });
    const b = manual({ id: 'b', quantity_base: 3 });
    expect(reconcileList({ listId: LIST, needs: [], items: [a, b], sources: [] }).ops).toEqual([]);
  });
});

describe('stableId', () => {
  it('is a version 8 UUID, the same for the same parts and different otherwise', () => {
    const id = stableId('list', 'ingredient.egg|count', '0');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableId('list', 'ingredient.egg|count', '0')).toBe(id);
    expect(stableId('list', 'ingredient.egg|count', '1')).not.toBe(id);
    expect(stableId('lis', 't')).not.toBe(stableId('list'));
    const many = new Set(Array.from({ length: 5000 }, (_, i) => stableId('x', String(i))));
    expect(many.size).toBe(5000);
  });
});
