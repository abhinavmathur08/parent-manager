import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

import enUS from './src/i18n/locales/en-US.json';

/**
 * App variants (F-03.1). Each EAS build profile sets APP_VARIANT in eas.json, so
 * development, preview and production builds get their own app ID and can be
 * installed side by side. Without APP_VARIANT the config is production's, which
 * keeps EAS commands that don't run a build (submit, credentials) on the store app.
 */
export const APP_VARIANTS = ['development', 'preview', 'production'] as const;
export type AppVariant = (typeof APP_VARIANTS)[number];

const BASE_ID = 'com.myparentmanager';
const BASE_NAME = 'Parent Manager';
const BASE_SCHEME = 'parentmanager';
const EAS_PROJECT_ID = '4981939e-671f-44b5-b428-9fa2a5338d17';

export function getAppVariant(value: string | undefined): AppVariant {
  if (!value) {
    return 'production';
  }
  if ((APP_VARIANTS as readonly string[]).includes(value)) {
    return value as AppVariant;
  }
  throw new Error(`Unknown APP_VARIANT "${value}". Use one of: ${APP_VARIANTS.join(', ')}.`);
}

const VARIANTS: Record<AppVariant, { id: string; name: string; scheme: string }> = {
  development: { id: `${BASE_ID}.dev`, name: `${BASE_NAME} (Dev)`, scheme: `${BASE_SCHEME}-dev` },
  preview: {
    id: `${BASE_ID}.preview`,
    name: `${BASE_NAME} (Preview)`,
    scheme: `${BASE_SCHEME}-preview`,
  },
  production: { id: BASE_ID, name: BASE_NAME, scheme: BASE_SCHEME },
};

export function getVariantConfig(variant: AppVariant) {
  return VARIANTS[variant];
}

/**
 * End-to-end tests only (E2E_LOCAL_BACKEND=1): lets an Android release build reach the local
 * Supabase stack over plain HTTP. iOS already allows local networking. Never set for builds
 * that ship.
 */
function withLocalBackendCleartext(config: ExpoConfig): ExpoConfig {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = getAppVariant(process.env.APP_VARIANT);
  const { id, name, scheme } = getVariantConfig(variant);
  const expoConfig = buildConfig(config, variant, id, name, scheme);
  return process.env.E2E_LOCAL_BACKEND === '1' ? withLocalBackendCleartext(expoConfig) : expoConfig;
};

/**
 * Google sign-in's iOS URL scheme is the iOS client ID reversed
 * (`com.googleusercontent.apps.<id>`). Without a client ID the plugin is left out: with no
 * options it would expect Firebase files. The app then hides the Google button
 * (src/features/auth/provider-config.ts).
 */
export function googleSignInPlugins(
  iosClientId: string | undefined,
): [string, { iosUrlScheme: string }][] {
  const id = iosClientId?.trim().replace(/\.apps\.googleusercontent\.com$/, '');
  return id
    ? [
        [
          '@react-native-google-signin/google-signin',
          { iosUrlScheme: `com.googleusercontent.apps.${id}` },
        ],
      ]
    : [];
}

/**
 * Sentry (F-07.1). The plugin is always on, so its native SDK is in every build. Source maps
 * upload from builds only when `SENTRY_ORG` and `SENTRY_PROJECT` are set, which also needs
 * the `SENTRY_AUTH_TOKEN` secret in EAS; without them builds skip the upload rather than
 * fail. Setting them changes the build script and so the runtime fingerprint: turn them on
 * with a new build, not an OTA update.
 */
export function sentryPlugin(
  organization: string | undefined,
  project: string | undefined,
): [string, Record<string, string | boolean>] {
  const org = organization?.trim();
  const name = project?.trim();
  return [
    '@sentry/react-native/expo',
    org && name ? { organization: org, project: name } : { disableAutoUpload: true },
  ];
}

function buildConfig(
  config: ConfigContext['config'],
  variant: AppVariant,
  id: string,
  name: string,
  scheme: string,
): ExpoConfig {
  return {
    ...config,
    name,
    slug: 'parent-manager',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme,
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/expo.icon',
      bundleIdentifier: id,
      supportsTablet: false,
      appleTeamId: '5JNGSJXS6A',
      // Sign in with Apple (A-02.1). EAS turns the capability on for the app ID when it builds.
      usesAppleSignIn: true,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      package: id,
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
      [
        'expo-font',
        {
          fonts: [
            './node_modules/@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf',
          ],
        },
      ],
      // The local copy of household data is encrypted with SQLCipher (H-06.2, FR-AUTH-7).
      ['expo-sqlite', { useSQLCipher: true }],
      'expo-localization',
      'expo-secure-store',
      'expo-apple-authentication',
      'expo-web-browser',
      ...googleSignInPlugins(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
      sentryPlugin(process.env.SENTRY_ORG, process.env.SENTRY_PROJECT),
      // The Face ID permission text comes from the locale file, like all copy (A-03).
      ['expo-local-authentication', { faceIDPermission: enUS.biometric.faceIdPermission }],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    platforms: ['ios', 'android'],
    // Over-the-air updates (F-03.3). The runtime version is a fingerprint of the native
    // project, so a native change gives binaries a new runtime and they never receive an
    // update built for different native code. The channel comes from the build profile
    // in eas.json, and app config changes alter the fingerprint, so publish with the
    // same APP_VARIANT the build used (`pnpm run update:preview`).
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    },
    extra: {
      appVariant: variant,
      eas: {
        projectId: EAS_PROJECT_ID,
      },
    },
    owner: 'abhinav08',
  };
}
