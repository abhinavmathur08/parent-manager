const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

// Text a user can see or hear must come from the locale files (CLAUDE.md, F-05).
const localizationRules = {
  files: ['src/**/*.tsx'],
  rules: {
    'react/jsx-no-literals': [
      'error',
      {
        noStrings: true,
        ignoreProps: true,
        allowedStrings: ['·', '…', '—', '–', '/', '(', ')', ':', '%', '+', '×', '•'],
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector:
          'JSXAttribute[name.name=/^(accessibilityLabel|accessibilityHint|placeholder|title|alt|aria-label)$/] > Literal',
        message: 'User-facing attribute text must come from t(). Add it to src/i18n/locales.',
      },
    ],
  },
};

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  localizationRules,
  globalIgnores(['dist/*', 'coverage/*', 'ios/*', 'android/*', 'supabase/functions/*']),
]);
