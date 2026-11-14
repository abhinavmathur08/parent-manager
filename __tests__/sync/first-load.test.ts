import { SyncEngine } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import type { SyncRemote } from '@/lib/sync/remote';
import type { SyncTableDefinition } from '@/lib/sync/types';
import { FakeServer } from '../../test-utils/sync/fake-server';
import { createTestDatabase } from '../../test-utils/sync/sqlite';

// Shapes like the recipe tables (R-02.1), with the text a real household has.
const recipes: SyncTableDefinition = {
  name: 'recipes',
  columns: {
    title: 'text',
    servings: 'integer',
    prep_minutes: 'integer',
    cook_minutes: 'integer',
    notes: 'text',
    source_url: 'text',
    tags: 'json',
  },
};
const ingredients: SyncTableDefinition = {
  name: 'recipe_ingredients',
  columns: {
    recipe_id: 'text',
    position: 'integer',
    ingredient_id: 'text',
    raw_text: 'text',
    quantity_base: 'real',
    unit: 'text',
  },
};
const steps: SyncTableDefinition = {
  name: 'recipe_steps',
  columns: { recipe_id: 'text', position: 'integer', body: 'text' },
};
const planEntries: SyncTableDefinition = {
  name: 'plan_entries',
  columns: { recipe_id: 'text', day: 'text', slot: 'text' },
};
const TABLES = [recipes, ingredients, steps, planEntries];

function device(server: FakeServer, remote: SyncRemote = server.remote(), tables = TABLES) {
  const db = createTestDatabase();
  return {
    db,
    open: async (defs = tables) => {
      const engine = new SyncEngine(new LocalStore(db, defs), remote, 'h1');
      await engine.open();
      return engine;
    },
  };
}

describe('first load on a new device (A-01.3, FR-AUTH-8)', () => {
  it('marks a device that has never pulled the household, until its first sync finishes', async () => {
    const server = new FakeServer();
    server.put('recipes', { id: 'r1', household_id: 'h1', title: 'Lasagne' });
    const engine = await device(server).open();
    expect(engine.getStatus().firstLoad).toBe(true);
    await engine.sync();
    expect(engine.getStatus()).toMatchObject({ firstLoad: false, state: 'idle' });
    expect(await engine.store.rows('recipes')).toHaveLength(1);
  });

  it('stays a first load while offline, then finishes once back online', async () => {
    const server = new FakeServer();
    server.offline = true;
    const engine = await device(server).open();
    await engine.sync();
    expect(engine.getStatus()).toMatchObject({ firstLoad: true, state: 'offline' });
    server.offline = false;
    await engine.sync();
    expect(engine.getStatus()).toMatchObject({ firstLoad: false, state: 'idle' });
  });

  it('is not a first load after a restart, even offline (NFR-OFF-1)', async () => {
    const server = new FakeServer();
    const phone = device(server);
    await (await phone.open()).sync();
    server.offline = true;
    const restarted = await phone.open();
    expect(restarted.getStatus().firstLoad).toBe(false);
  });

  it('is not a first load when an app update adds a table', async () => {
    const server = new FakeServer();
    const phone = device(server);
    await (await phone.open([recipes])).sync();
    const updated = await phone.open(TABLES);
    expect(updated.getStatus().firstLoad).toBe(false);
  });

  it('pulls every table at once, so the wait is the slowest table, not the sum', async () => {
    const server = new FakeServer();
    const inner = server.remote();
    let inFlight = 0;
    let most = 0;
    const remote: SyncRemote = {
      ...inner,
      fetchPage: async (...args) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return inner.fetchPage(...args);
      },
    };
    await (await device(server, remote).open()).sync();
    expect(most).toBe(TABLES.length);
  });

  it('finishes every table before reporting a failure', async () => {
    const server = new FakeServer();
    server.put('recipe_steps', { id: 's1', household_id: 'h1', body: 'Boil water' });
    const inner = server.remote();
    const remote: SyncRemote = {
      ...inner,
      fetchPage: async (table, ...rest) => {
        if (table === 'recipes') throw new Error('Network request failed');
        await new Promise((resolve) => setTimeout(resolve, 5));
        return inner.fetchPage(table, ...rest);
      },
    };
    const engine = await device(server, remote).open();
    await engine.sync();
    expect(engine.getStatus()).toMatchObject({ state: 'offline', firstLoad: true });
    // The tables that answered are already on the device for the next try.
    expect(await engine.store.rows('recipe_steps')).toHaveLength(1);
  });
});

/** A 4G connection, on the slow side: 150 ms per request and 5 Mbit/s down. */
const ROUND_TRIP_MS = 150;
const BYTES_PER_MS = 5_000_000 / 8 / 1000;

function over4G(remote: SyncRemote): SyncRemote {
  return {
    ...remote,
    fetchPage: async (...args) => {
      const rows = await remote.fetchPage(...args);
      const transfer = JSON.stringify(rows).length / BYTES_PER_MS;
      await new Promise((resolve) => setTimeout(resolve, ROUND_TRIP_MS + transfer));
      return rows;
    },
  };
}

const words = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => `word${(seed * 31 + i) % 97}`).join(' ');

describe('first-load speed (FR-AUTH-8)', () => {
  it('loads a household with 200 recipes within 5 seconds on 4G', async () => {
    const server = new FakeServer();
    for (let r = 0; r < 200; r += 1) {
      const id = `recipe-${String(r).padStart(3, '0')}`;
      server.put('recipes', {
        id,
        household_id: 'h1',
        title: words(5, r),
        servings: 4,
        prep_minutes: 15,
        cook_minutes: 40,
        notes: words(40, r),
        source_url: `https://example.com/recipes/${id}`,
        tags: ['tag.weeknight', 'tag.freezer_friendly'],
      });
      for (let i = 0; i < 12; i += 1) {
        server.put('recipe_ingredients', {
          id: `${id}-i${i}`,
          household_id: 'h1',
          recipe_id: id,
          position: i,
          ingredient_id: `ingredient.item_${i}`,
          raw_text: words(6, r + i),
          quantity_base: 250,
          unit: 'unit.gram',
        });
      }
      for (let s = 0; s < 8; s += 1) {
        server.put('recipe_steps', {
          id: `${id}-s${s}`,
          household_id: 'h1',
          recipe_id: id,
          position: s,
          body: words(30, r + s),
        });
      }
    }
    for (let d = 0; d < 365; d += 1) {
      server.put('plan_entries', {
        id: `plan-${d}`,
        household_id: 'h1',
        recipe_id: `recipe-${String(d % 200).padStart(3, '0')}`,
        day: `2026-${String((d % 12) + 1).padStart(2, '0')}-01`,
        slot: 'slot.dinner',
      });
    }

    const started = Date.now();
    const engine = await device(server, over4G(server.remote())).open();
    expect(engine.getStatus().firstLoad).toBe(true);
    await engine.sync();
    const elapsed = Date.now() - started;

    expect(engine.getStatus().firstLoad).toBe(false);
    expect(await engine.store.rows('recipes')).toHaveLength(200);
    expect(await engine.store.rows('recipe_ingredients')).toHaveLength(2400);
    expect(await engine.store.rows('recipe_steps')).toHaveLength(1600);
    expect(elapsed).toBeLessThan(5000);
  }, 20_000);
});
