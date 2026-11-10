/**
 * Which sign-in providers are configured for this build. Expo inlines EXPO_PUBLIC_* at
 * build time, and only in this exact dotted form.
 *
 * Sign in with Apple on Android goes through Apple's web sign-in, which needs a Services ID
 * and key in the Supabase project. Set EXPO_PUBLIC_APPLE_WEB_SIGN_IN=1 once it's set up;
 * until then the button is hidden on Android. iOS uses the native sheet and needs nothing.
 */
export const appleWebSignInEnabled = process.env.EXPO_PUBLIC_APPLE_WEB_SIGN_IN === '1';
