import type { ConfigContext, ExpoConfig } from 'expo/config';

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

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = getAppVariant(process.env.APP_VARIANT);
  const { id, name, scheme } = getVariantConfig(variant);

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
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    platforms: ['ios', 'android'],
    extra: {
      appVariant: variant,
      eas: {
        projectId: '4981939e-671f-44b5-b428-9fa2a5338d17',
      },
    },
    owner: 'abhinav08',
  };
};
