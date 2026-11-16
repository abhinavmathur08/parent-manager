// The AI import evaluation against a real provider (R-05.4): `pnpm run eval:ai`.
// See ai-eval/README.md. It's not part of `pnpm test`; CI runs the fake-provider version in
// __tests__/import/ai-eval.test.ts instead, so CI needs no API key.
const { jest: base } = require('../package.json');

module.exports = {
  ...base,
  rootDir: '..',
  testMatch: ['<rootDir>/ai-eval/live.eval.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
