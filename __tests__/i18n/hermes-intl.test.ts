// Hermes, the app's JavaScript engine, lacks some Intl APIs that Node and Jest have, so a
// direct call passes every unit test and then crashes the release app (the device calendar
// copy did this on Android, #216). Those APIs go through the helpers in src/i18n/format.ts,
// which fall back when they're missing.
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { recursive: true }): string[];
}>('fs');

const MISSING_ON_HERMES = /\bIntl\.(ListFormat|RelativeTimeFormat|Segmenter|DisplayNames)\b/;
const allowed = new Set(['i18n/format.ts']);

describe('Intl APIs that Hermes lacks', () => {
  it('are used only through the src/i18n helpers', () => {
    const root = `${process.cwd()}/src`;
    const offenders = fs
      .readdirSync(root, { recursive: true })
      .map((file) => file.split('\\').join('/'))
      .filter((file) => /\.tsx?$/.test(file) && !allowed.has(file))
      .filter((file) => MISSING_ON_HERMES.test(fs.readFileSync(`${root}/${file}`, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
