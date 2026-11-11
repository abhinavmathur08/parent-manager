// The household sync layer (architecture section 5, D-13). Features import from here.
export { defineSyncTable } from '@/lib/sync/registry';
export {
  resetSync,
  SyncProvider,
  useSyncedRows,
  useSyncEngine,
  useSyncStatus,
  useSyncWriter,
} from '@/lib/sync/provider';
export { PendingChangesBanner } from '@/lib/sync/pending-changes-banner';
export type { SyncStatus, SyncState } from '@/lib/sync/engine';
export type { ColumnType, SyncRow, SyncTableDefinition } from '@/lib/sync/types';
