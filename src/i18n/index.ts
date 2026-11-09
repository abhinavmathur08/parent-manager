import i18n from './instance';
import type { AppLocale } from './locale';

export { formatCurrency, formatDate, formatNumber, formatQuantity } from './format';
export { DEFAULT_LOCALE, PSEUDO_LOCALE, SUPPORTED_LOCALES, resolveLocale } from './locale';
export type { AppLocale } from './locale';
export { displayQuantity, REGIONAL_UNITS, toBase, UNITS, UNMEASURED_UNITS } from './units';
export type {
  Dimension,
  QuantityPart,
  Region,
  RegionalUnitWord,
  UnitId,
  UnitSystem,
  UnmeasuredUnitId,
} from './units';
export { i18n };

/** Switches the app's language, for example to the household's locale after sign-in. */
export function setAppLocale(locale: AppLocale) {
  return i18n.changeLanguage(locale);
}
