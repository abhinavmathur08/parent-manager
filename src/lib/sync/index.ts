// The household sync layer (architecture section 5, D-13). Features import from here.
export { defineSyncTable } from '@/lib/sync/registry';
export {
  resetSync,
  SyncProvider,
  useSyncedRows,
  useSyncEngine,
  useSyncStatus,
} from '@/lib/sync/provider';
export type { SyncStatus, SyncState } from '@/lib/sync/engine';
export type { ColumnType, SyncRow, SyncTableDefinition } from '@/lib/sync/types';
