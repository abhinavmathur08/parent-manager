// The two-device sync harness (H-06.3, NFR-OFF-5). It needs a local Supabase stack with
// test-utils/sync/harness/schema.sql applied; see the "Sync harness" job in ci.yml.
// Plain Node, without the jest-expo preset: the engine has no React Native code, and the
// harness talks to a real server with Node's own fetch and WebSocket.
const { jest: base } = require('../../../package.json');

module.exports = {
  rootDir: '../../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test-utils/sync/harness/*.harness.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: { '\\.tsx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  moduleNameMapper: base.moduleNameMapper,
};
