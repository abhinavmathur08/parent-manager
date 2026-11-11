import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

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
      'expo-sqlite',
      'expo-localization',
      'expo-secure-store',
      'expo-apple-authentication',
      'expo-web-browser',
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
