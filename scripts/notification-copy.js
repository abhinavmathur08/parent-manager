// Builds the push copy the `notify` Edge Function sends from the app's locale files (N-01.3,
// FR-NOT-9), so push text is translated like every other string (CLAUDE.md, localization
// rules) and chosen on the server by the recipient's locale.
//
//   node scripts/notification-copy.js --check   fail if the copy is out of date (CI)
//   node scripts/notification-copy.js --write   regenerate after a copy change
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const LOCALES = ['en-US', 'en-GB', 'en-AU'];
const DEFAULT_LOCALE = 'en-US';
// The types the server pushes. Household changes are inbox only, and the app writes their text.
const PUSH_TYPES = ['plan_week', 'list_ready', 'test', 'event_changed', 'who_taking'];
const OUTPUT = path.join(root, 'supabase/functions/notify/copy.json');

function messages(locale) {
  const file = path.join(root, `src/i18n/locales/${locale}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')).notifications?.messages ?? {};
}

function build() {
  const fallback = messages(DEFAULT_LOCALE);
  const copy = {};
  for (const locale of LOCALES) {
    // Regional files only hold what differs from en-US, like i18next's fallback.
    const own = locale === DEFAULT_LOCALE ? {} : messages(locale);
    copy[locale] = {};
    for (const type of PUSH_TYPES) {
      const text = { ...fallback[type], ...own[type] };
      for (const field of ['title', 'body']) {
        if (typeof text[field] !== 'string' || text[field].length === 0) {
          throw new Error(`notifications.messages.${type}.${field} is missing for ${locale}`);
        }
        // Pushes are sent as they are: no placeholders, so nothing personal can be filled in.
        if (text[field].includes('{{')) {
          throw new Error(`notifications.messages.${type}.${field} must not have placeholders`);
        }
      }
      copy[locale][type] = { title: text.title, body: text.body };
    }
  }
  return `${JSON.stringify(copy, null, 2)}\n`;
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') {
    console.error('Usage: node scripts/notification-copy.js --check | --write');
    process.exit(2);
  }
  const expected = build();
  if (mode === '--write') {
    fs.writeFileSync(OUTPUT, expected);
  } else {
    const actual = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
    if (actual !== expected) {
      console.error(
        'supabase/functions/notify/copy.json is out of date. Run: pnpm run notify:copy',
      );
      process.exit(1);
    }
  }
  console.log(mode === '--write' ? 'Push copy written.' : 'Push copy is current.');
}

main();
