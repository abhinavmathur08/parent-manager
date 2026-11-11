/**
 * Which sign-in providers are configured for this build. Expo inlines EXPO_PUBLIC_* at
 * build time, and only in this exact dotted form.
 *
 * Sign in with Apple on Android goes through Apple's web sign-in, which needs a Services ID
 * and key in the Supabase project. Set EXPO_PUBLIC_APPLE_WEB_SIGN_IN=1 once it's set up;
 * until then the button is hidden on Android. iOS uses the native sheet and needs nothing.
 */
export const appleWebSignInEnabled = process.env.EXPO_PUBLIC_APPLE_WEB_SIGN_IN === '1';

/**
 * Google sign-in (A-02.2) needs OAuth client IDs from Google Cloud: the web client ID (the
 * ID token's audience, also set in Supabase) on both platforms, and an iOS client ID on iOS.
 * Without them the Google button is hidden. Android also needs an Android client ID for
 * each signing key's SHA-1, which Google matches by package name, so the app never reads it.
 */
export const googleConfig = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || null,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || null,
};

/** Whether Google sign-in is configured for this platform. */
export function isGoogleConfigured(
  os: string,
  config: { webClientId: string | null; iosClientId: string | null } = googleConfig,
): boolean {
  if (!config.webClientId) return false;
  return os === 'ios' ? !!config.iosClientId : os === 'android';
}
