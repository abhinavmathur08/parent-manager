/**
 * Pseudo-localization for development builds (NFR-L10N-4). Accents every letter and
 * doubles the length, so untranslated strings and layouts that can't stretch stand out.
 * Interpolations ({{name}}) and tags (<b>) are left intact.
 */
const ACCENTED: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

const PROTECTED = /(\{\{[^}]*\}\}|<[^>]+>)/g;

export function pseudoLocalize(text: string, expansion = 1): string {
  if (!text) return text;
  let visible = 0;
  const body = text
    .split(PROTECTED)
    .map((part, i) => {
      if (i % 2 === 1) return part; // a protected placeholder or tag
      visible += part.length;
      return part.replace(/[A-Za-z]/g, (ch) => ACCENTED[ch] ?? ch);
    })
    .join('');
  return `⟦${body}${'~'.repeat(Math.ceil(visible * expansion))}⟧`;
}

export const pseudoPostProcessor = {
  type: 'postProcessor' as const,
  name: 'pseudo',
  process: (value: string) => pseudoLocalize(value),
};
