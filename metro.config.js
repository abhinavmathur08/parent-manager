// Sentry's Metro config adds debug IDs to bundles, so uploaded source maps match the
// running code and stack traces are readable (F-07.1, NFR-OBS-1).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
