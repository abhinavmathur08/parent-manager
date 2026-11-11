import { SYSTEM_COLUMNS, type ColumnType, type SyncTableDefinition } from '@/lib/sync/types';

// Table and column names go into SQL text, so only plain identifiers are allowed.
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

const tables = new Map<string, SyncTableDefinition>();

/**
 * Checks a table definition. Names are interpolated into SQL, so they must be plain
 * lower-case identifiers, and a table can't redefine a system column.
 */
export function validateDefinition(definition: SyncTableDefinition): SyncTableDefinition {
  if (!IDENTIFIER.test(definition.name) || definition.name.startsWith('sync_')) {
    throw new Error(`Invalid sync table name: ${definition.name}`);
  }
  for (const column of Object.keys(definition.columns)) {
    if (
      !IDENTIFIER.test(column) ||
      column.startsWith('sync_') ||
      (SYSTEM_COLUMNS as readonly string[]).includes(column)
    ) {
      throw new Error(`Invalid column ${column} on sync table ${definition.name}`);
    }
  }
  return definition;
}

/**
 * Registers a table for household sync. Features call this once at module load, for
 * example `defineSyncTable({ name: 'grocery_items', columns: { name: 'text', checked: 'boolean' } })`.
 * The server table must have the system columns and `private.enable_sync()` (H-06.3).
 */
export function defineSyncTable<C extends Record<string, ColumnType>>(definition: {
  name: string;
  columns: C;
}): SyncTableDefinition {
  const checked = validateDefinition(definition);
  tables.set(checked.name, checked);
  return checked;
}

/** Every registered table, in registration order. */
export function registeredTables(): SyncTableDefinition[] {
  return [...tables.values()];
}

/** Test helper: forgets every registered table. */
export function clearRegistry(): void {
  tables.clear();
}
