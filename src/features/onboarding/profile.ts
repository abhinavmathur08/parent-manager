import { getSupabase } from '@/lib/supabase';

/** The user's display name, or null if they haven't given one yet (FR-AUTH-4). */
export async function fetchDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle<{ display_name: string | null }>();
  if (error) throw error;
  return data?.display_name ?? null;
}

export async function saveDisplayName(userId: string, name: string): Promise<void> {
  const { error } = await getSupabase()
    .from('profiles')
    .update({ display_name: name.trim() })
    .eq('id', userId);
  if (error) throw error;
}
