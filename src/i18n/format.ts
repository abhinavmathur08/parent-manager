import i18n from './instance';
import { UNITS, type QuantityPart } from './units';

/**
 * Locale-aware formatting (CLAUDE.md localization rules). Never build dates, numbers,
 * money or quantities by joining strings or calling toFixed().
 */
export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCurrency(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

export function formatDate(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

const FRACTIONS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** 1.5 becomes "1½" and 0.25 becomes "¼". Other values fall back to locale decimals. */
function formatFraction(value: number, locale: string): string {
  const whole = Math.floor(value);
  const rest = Math.round((value - whole) * 100) / 100;
  const glyph = FRACTIONS[rest];
  if (rest === 0) return formatNumber(whole, locale);
  if (!glyph) return formatNumber(value, locale, { maximumFractionDigits: 2 });
  return whole === 0 ? glyph : `${formatNumber(whole, locale)}${glyph}`;
}

/**
 * Formats quantity parts such as [{ value: 1.5, unitId: 'unit.cup_us' }] as "1½ cups",
 * with unit names from the locale files. Counts show the number only ("3").
 */
export function formatQuantity(parts: QuantityPart | QuantityPart[], locale: string): string {
  const t = i18n.getFixedT(locale);
  return (Array.isArray(parts) ? parts : [parts])
    .map(({ value, unitId }) => {
      const unit = UNITS[unitId];
      const amount = unit.fractions
        ? formatFraction(value, locale)
        : formatNumber(value, locale, { maximumFractionDigits: 1 });
      // English treats amounts up to 1 as singular ("½ cup", "1 cup").
      const label = t(`units.${unit.label}`, { count: value > 1 ? 2 : 1 });
      return label ? `${amount} ${label}` : amount;
    })
    .join(' ');
}
