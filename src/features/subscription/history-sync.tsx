import { useEffect, useRef } from 'react';

import { useSyncEngine } from '@/lib/sync';

import { useEntitlement } from './entitlement';

/** The synced tables the free history window applies to (G-08, FR-PAY-6). */
export const HISTORY_TABLES = [
  'plan_entries',
  'plan_entry_portions',
  'grocery_lists',
  'grocery_items',
  'grocery_item_sources',
] as const;

/**
 * When the tier changes, what the server lets the household read changes too: Premium returns
 * older weeks, and a lapse hides them (FR-PAY-9). Pulls those tables in full so this device
 * matches. Renders nothing.
 */
export function HistorySync() {
  const engine = useSyncEngine();
  const { entitlement } = useEntitlement();
  const tier = entitlement?.tier ?? null;
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (!tier) return;
    const before = previous.current;
    previous.current = tier;
    if (before && before !== tier && engine)
      void engine.refetch(HISTORY_TABLES).catch(() => undefined);
  }, [tier, engine]);

  return null;
}
