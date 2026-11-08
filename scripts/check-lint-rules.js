// Checks that the localization lint rules catch hard-coded user-facing text (F-05).
// Runs outside Jest, because Expo's Jest preset doesn't allow ESLint's lazy loading.
const assert = require('node:assert/strict');
const { ESLint } = require('eslint');

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: require('../eslint.config.js'),
  cwd: require('node:path').join(__dirname, '..'),
});

async function ruleIds(code) {
  const [result] = await eslint.lintText(code, { filePath: 'src/app/example.tsx' });
  return result.messages.map((m) => m.ruleId);
}

const cases = [
  [
    'text written directly in JSX',
    'export const A = () => <Text>Add a meal</Text>;\n',
    'react/jsx-no-literals',
    true,
  ],
  [
    'an untranslated accessibility label',
    'export const A = () => <View accessibilityLabel="Add a meal" />;\n',
    'no-restricted-syntax',
    true,
  ],
  [
    'a string literal inside braces',
    "export const A = () => <Text>{'Add a meal'}</Text>;\n",
    'react/jsx-no-literals',
    true,
  ],
  [
    'translated text with a testID',
    'export const A = ({ t }) => <Text testID="x">{t(\'home.title\')}</Text>;\n',
    'react/jsx-no-literals',
    false,
  ],
];

(async () => {
  for (const [name, code, rule, expected] of cases) {
    const ids = await ruleIds(code);
    assert.equal(
      ids.includes(rule),
      expected,
      `${name}: expected ${rule} to ${expected ? 'fire' : 'stay quiet'}, got ${JSON.stringify(ids)}`,
    );
    console.log(`ok - ${name}`);
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
