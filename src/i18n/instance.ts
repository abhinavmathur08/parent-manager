import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LOCALE, PSEUDO_LOCALE, SUPPORTED_LOCALES, resolveLocale } from './locale';
import enAU from './locales/en-AU.json';
import enGB from './locales/en-GB.json';
import enUS from './locales/en-US.json';
import { pseudoPostProcessor } from './pseudo';

/** Development builds only: set EXPO_PUBLIC_PSEUDO_LOCALE=1 to show the pseudo-locale. */
export const pseudoEnabled = __DEV__ && process.env.EXPO_PUBLIC_PSEUDO_LOCALE === '1';

function deviceLocale() {
  try {
    return resolveLocale(getLocales());
  } catch {
    return DEFAULT_LOCALE;
  }
}

// A dedicated instance, so the app never shares i18next state with libraries.
const i18n = createInstance();

i18n
  .use(initReactI18next)
  .use(pseudoPostProcessor)
  .init({
    resources: {
      'en-US': { translation: enUS },
      'en-GB': { translation: enGB },
      'en-AU': { translation: enAU },
      [PSEUDO_LOCALE]: { translation: enUS },
    },
    lng: pseudoEnabled ? PSEUDO_LOCALE : deviceLocale(),
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES, PSEUDO_LOCALE],
    load: 'currentOnly',
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    postProcess: pseudoEnabled ? ['pseudo'] : false,
  });

export default i18n;
