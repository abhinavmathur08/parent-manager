import { formatNumber } from '@/i18n';

const VULGAR: Record<string, string> = {
  '½': '1/2',
  '⅓': '1/3',
  '⅔': '2/3',
  '¼': '1/4',
  '¾': '3/4',
  '⅛': '1/8',
};

const decimalSeparator = (locale: string) =>
  new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';

/**
 * Reads a typed quantity (FR-REC-5): whole numbers, fractions ("1/2"), mixed numbers
 * ("1 1/2" or "1½") and decimals in the locale's format. Returns null for an empty field and
 * undefined for text that isn't a quantity.
 */
export function parseQuantityText(text: string, locale: string): number | null | undefined {
  const prepared = text
    .replace(/[½⅓⅔¼¾⅛]/g, (c) => ` ${VULGAR[c]}`)
    .replace(/⁄/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  if (prepared === '') return null;
  const sep = decimalSeparator(locale);
  const fraction = (word: string) => {
    const m = /^(\d+)\/(\d+)$/.exec(word);
    return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : undefined;
  };
  const decimal = (word: string) => {
    const pattern = new RegExp(`^\\d+(?:${sep === '.' ? '\\.' : sep}\\d+)?$`);
    return pattern.test(word) ? Number(word.replace(sep, '.')) : undefined;
  };
  const words = prepared.split(' ');
  let value: number | undefined;
  if (words.length === 1) value = fraction(words[0]) ?? decimal(words[0]);
  else if (words.length === 2 && /^\d+$/.test(words[0])) {
    const part = fraction(words[1]);
    value = part === undefined ? undefined : Number(words[0]) + part;
  }
  return value !== undefined && value > 0 && value < 100000 ? value : undefined;
}

const FRACTIONS: [number, string][] = [
  [1 / 8, '1/8'],
  [1 / 4, '1/4'],
  [1 / 3, '1/3'],
  [1 / 2, '1/2'],
  [2 / 3, '2/3'],
  [3 / 4, '3/4'],
];

/** Writes a stored quantity back as editable text: 1.5 as "1 1/2", 0.25 as "1/4", 2.4 as "2.4". */
export function quantityToText(value: number | null, locale: string): string {
  if (value === null) return '';
  const whole = Math.floor(value);
  const rest = value - whole;
  if (rest < 1e-6) return formatNumber(whole, locale, { useGrouping: false });
  const match = FRACTIONS.find(([f]) => Math.abs(rest - f) < 1e-3);
  if (match) return whole ? `${whole} ${match[1]}` : match[1];
  return formatNumber(value, locale, { useGrouping: false, maximumFractionDigits: 3 });
}
