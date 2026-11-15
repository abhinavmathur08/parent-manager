import { useCallback, useEffect, useState } from 'react';

import { todayIn, type PlanDate } from '@/features/planner/week';
import { getSupabase } from '@/lib/supabase';

export type ListReadyTrigger = 'button' | 'week_planned';

/**
 * Tells the household's other members the list for the week starting `week` is ready
 * (FR-NOT-4). The server sends it at most once per list per day, whichever trigger comes
 * first; `already_sent` means someone did today.
 */
export async function announceListReady(
  week: PlanDate,
  trigger: ListReadyTrigger,
): Promise<'sent' | 'already_sent'> {
  const { data, error } = await getSupabase().rpc('announce_list_ready', { week, source: trigger });
  if (error) throw error;
  return data === 'already_sent' ? 'already_sent' : 'sent';
}

async function sentToday(householdId: string, week: PlanDate, today: PlanDate): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('list_ready_events')
    .select('week_start')
    .eq('household_id', householdId)
    .eq('week_start', week)
    .eq('local_date', today)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type ListReadyState = 'unknown' | 'ready' | 'sending' | 'sent';

/**
 * The List tab's "list is ready" button state: `sent` once anyone announced this week's list
 * today (in the household's timezone), so the button can say so instead of sending again.
 */
export function useListReady(
  householdId: string,
  week: PlanDate,
  timezone: string | null,
): { state: ListReadyState; announce: () => Promise<boolean> } {
  const [state, setState] = useState<ListReadyState>('unknown');

  useEffect(() => {
    let active = true;
    sentToday(householdId, week, todayIn(timezone))
      .then((sent) => {
        if (active) setState(sent ? 'sent' : 'ready');
      })
      .catch(() => {
        if (active) setState('ready');
      });
    return () => {
      active = false;
    };
  }, [householdId, week, timezone]);

  const announce = useCallback(async () => {
    setState('sending');
    try {
      await announceListReady(week, 'button');
      setState('sent');
      return true;
    } catch {
      setState('ready');
      return false;
    }
  }, [week]);

  return { state, announce };
}
