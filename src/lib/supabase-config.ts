export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

/** Returns the config if both values are usable, otherwise null. */
export function parseSupabaseConfig(
  url: string | undefined,
  publishableKey: string | undefined,
): SupabaseConfig | null {
  const trimmedUrl = url?.trim();
  const trimmedKey = publishableKey?.trim();
  if (!trimmedUrl || !trimmedKey || !/^https?:\/\/\S+$/.test(trimmedUrl)) {
    return null;
  }
  return { url: trimmedUrl, publishableKey: trimmedKey };
}

// Expo inlines EXPO_PUBLIC_* at build time, and only for this exact dotted form:
// don't destructure process.env or access it dynamically.
export const supabaseConfig = parseSupabaseConfig(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
